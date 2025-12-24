#!/usr/bin/env python3
"""
HTTP сервер для извлечения радиомических признаков (принимает файлы как base64)
"""

import asyncio
import json
import os
import base64
import tempfile
import logging
from datetime import datetime
import pandas as pd
import SimpleITK as sitk
import numpy as np
from radiomics import featureextractor
import aiohttp
from aiohttp import web
from aiohttp.web import Request, Response
import aiofiles


from model_inference_VB import get_ai_result

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Конфигурация
HTTP_HOST = '0.0.0.0'
HTTP_PORT = 54006
PARAMS_FILE = 'EV_rad.yaml'
DOWNSTREAM_SERVER_URL = 'http://localhost:54006/upload'  # Опционально
MAX_FILE_SIZE = 100 * 100 * 1024 * 1024  # 100 MB


def detect_mask_label(mask_path):
    """
    Автоматически определяет label маски, находя ненулевые значения
    """
    try:
        mask_image = sitk.ReadImage(mask_path)
        mask_array = sitk.GetArrayFromImage(mask_image)

        unique_values = np.unique(mask_array)
        nonzero_values = unique_values[unique_values != 0]

        if len(nonzero_values) == 0:
            raise ValueError("Маска не содержит ненулевых значений")

        label = int(nonzero_values[0])
        logger.info(f"Автоматически определен label маски: {label}")

        if len(nonzero_values) > 1:
            logger.warning(f"В маске найдено несколько значений: {nonzero_values}. Используется первое: {label}")

        return label

    except Exception as e:
        logger.error(f"Ошибка при определении label маски: {str(e)}")
        raise


def extract_radiomics_features(image_path, mask_path, params_file, label=None):
    """
    Извлекает радиомические признаки из изображения .nii
    """
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Файл изображения не найден: {image_path}")
    if not os.path.exists(mask_path):
        raise FileNotFoundError(f"Файл маски не найден: {mask_path}")
    if not os.path.exists(params_file):
        raise FileNotFoundError(f"Файл параметров не найден: {params_file}")

    if label is None:
        label = detect_mask_label(mask_path)

    logger.info(f"Загрузка изображения: {image_path}")
    logger.info(f"Загрузка маски: {mask_path}")
    logger.info(f"Использование параметров: {params_file}")
    logger.info(f"Label маски: {label}")

    try:
        extractor = featureextractor.RadiomicsFeatureExtractor(params_file)

        logger.info("Начало извлечения признаков...")
        result = extractor.execute(image_path, mask_path, label=label)

        logger.info(f"Успешно извлечено {len(result)} признаков")
        return result

    except Exception as e:
        logger.error(f"Ошибка при извлечении признаков: {str(e)}")
        raise


def features_to_dataframe(features_dict):
    """
    Преобразует словарь признаков в pandas DataFrame
    """
    metadata = {}
    features = {}

    for key, value in features_dict.items():
        if key.startswith('diagnostics_'):
            metadata[key] = value
        else:
            features[key] = value

    df_features = pd.DataFrame([features])
    df_metadata = pd.DataFrame([metadata])
    df_full = pd.concat([df_metadata, df_features], axis=1)

    return df_full


def convert_to_json_serializable(obj):
    """
    Рекурсивно преобразует объекты numpy/pandas в JSON-сериализуемые типы Python
    """
    if isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    elif isinstance(obj, (np.complexfloating, complex)):
        return str(obj)  # Комплексные числа как строки
    elif isinstance(obj, dict):
        return {key: convert_to_json_serializable(value) for key, value in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [convert_to_json_serializable(item) for item in obj]
    elif pd.isna(obj):
        return None
    elif isinstance(obj, (pd.Timestamp, datetime)):
        return obj.isoformat() if hasattr(obj, 'isoformat') else str(obj)
    else:
        # Для других типов пытаемся преобразовать в строку или возвращаем как есть
        try:
            json.dumps(obj)  # Проверяем, можно ли сериализовать
            return obj
        except (TypeError, ValueError):
            return str(obj)


async def send_to_downstream_server(csv_path, session_id):
    """
    Отправляет CSV файл на следующий сервер (опционально)
    """
    try:
        logger.info(f"Отправка результатов на downstream сервер: {DOWNSTREAM_SERVER_URL}")

        async with aiohttp.ClientSession() as session:
            async with aiofiles.open(csv_path, 'rb') as f:
                csv_data = await f.read()

            data = aiohttp.FormData()
            data.add_field('file',
                          csv_data,
                          filename=os.path.basename(csv_path),
                          content_type='text/csv')
            data.add_field('session_id', session_id)

            async with session.post(DOWNSTREAM_SERVER_URL, data=data, timeout=aiohttp.ClientTimeout(total=60)) as response:
                if response.status == 200:
                    result = await response.json()
                    logger.info(f"Файл успешно отправлен на downstream сервер: {result}")
                    return True
                else:
                    error_text = await response.text()
                    logger.error(f"Ошибка при отправке на downstream сервер: {response.status} - {error_text}")
                    return False

    except Exception as e:
        logger.error(f"Исключение при отправке на downstream сервер: {str(e)}")
        return False


async def process_radiomics_request(image_data, mask_data, session_id=None, label=None):
    """
    Обрабатывает запрос на извлечение радиомических признаков

    Parameters:
    -----------
    image_data : bytes
        Бинарные данные изображения
    mask_data : bytes
        Бинарные данные маски
    session_id : str, optional
        ID сессии
    label : int, optional
        Label маски (если не указан - определяется автоматически)
    """
    if session_id is None:
        session_id = datetime.now().strftime('%Y%m%d_%H%M%S')
    logger.info(f"[{session_id}] Начало обработки запроса")

    # Проверяем наличие файлов
    if not image_data:
        raise ValueError("Отсутствуют данные изображения")
    if not mask_data:
        raise ValueError("Отсутствуют данные маски")

    # Проверяем размер файлов
    image_size = len(image_data)
    mask_size = len(mask_data)

    if image_size > MAX_FILE_SIZE or mask_size > MAX_FILE_SIZE:
        raise ValueError(f"Размер файла превышает максимальный ({MAX_FILE_SIZE / 1024 / 1024} MB)")

    logger.info(f"[{session_id}] Размер изображения: {image_size} bytes")
    logger.info(f"[{session_id}] Размер маски: {mask_size} bytes")

    with tempfile.TemporaryDirectory() as temp_dir:
        try:
            # Сохраняем изображение
            logger.info(f"[{session_id}] Сохранение изображения...")
            image_path = os.path.join(temp_dir, f'image_{session_id}.nii')
            with open(image_path, 'wb') as f:
                f.write(image_data)
            logger.info(f"[{session_id}] Изображение сохранено: {len(image_data)} bytes")

            # Сохраняем маску
            logger.info(f"[{session_id}] Сохранение маски...")
            mask_path = os.path.join(temp_dir, f'mask_{session_id}.nii')
            with open(mask_path, 'wb') as f:
                f.write(mask_data)
            logger.info(f"[{session_id}] Маска сохранена: {len(mask_data)} bytes")

            # Извлекаем признаки
            logger.info(f"[{session_id}] Начало извлечения признаков...")
            features = extract_radiomics_features(
                image_path,
                mask_path,
                PARAMS_FILE,
                label=label  # Опциональный параметр label
            )

            # Преобразуем в DataFrame
            df = features_to_dataframe(features)
            #df.insert(0, 'session_id', session_id)
            #df.insert(1, 'timestamp', datetime.now().isoformat())

            # Сохраняем в CSV (опционально)
            csv_filename = f'radiomics_features_{session_id}.csv'
            csv_path = os.path.join(os.getcwd(), csv_filename)
            df.to_csv(csv_path, index=False)
            logger.info(f"[{session_id}] Признаки извлечены и сохранены в {csv_filename}")

            # Отправляем на downstream сервер (опционально)
            #if DOWNSTREAM_SERVER_URL:
            #    logger.info(f"[{session_id}] Отправка результатов на downstream сервер...")
            #    await send_to_downstream_server(csv_path, session_id)

            # Возвращаем результаты
            # Преобразуем DataFrame в словарь и конвертируем numpy типы
            features_dict = df.to_dict('records')[0]
            features_dict_serializable = convert_to_json_serializable(features_dict)

            return {
                'status': 'success',
                'session_id': session_id,
                'path': csv_path
                #'features_count': len(df.columns),
                #'features': features_dict_serializable,  # JSON-сериализуемый словарь
                #'csv_data': df.to_csv(index=False)  # CSV как строка
            }

        except Exception as e:
            logger.error(f"[{session_id}] Ошибка обработки: {str(e)}", exc_info=True)
            raise


async def handle_radiomics(request: Request) -> Response:
    """
    Обработчик POST запроса для извлечения радиомических признаков
    Поддерживает multipart/form-data с бинарными файлами
    """
    try:
        # Проверяем Content-Type
        content_type = request.headers.get('Content-Type', '')

        if 'multipart/form-data' in content_type:
            # Multipart form data с бинарными файлами
            form_data = await request.post()

            # Получаем файлы
            image_file_1 = form_data.get('image1') # art_path
            mask_file_1 = form_data.get('mask1')

            image_file_2 = form_data.get('image2') # port_path
            mask_file_2 = form_data.get('mask2')

            if not image_file_1:
                raise ValueError("Отсутствует файл изображения 1")
            if not mask_file_1:
                raise ValueError("Отсутствует файл маски 2")

            if not image_file_2:
                raise ValueError("Отсутствует файл изображения 2")
            if not mask_file_2:
                raise ValueError("Отсутствует файл маски 2")

            # Читаем бинарные данные из файлов
            if hasattr(image_file_1, 'file'):
                # aiohttp FileField
                image_data_1 = image_file_1.file.read()
            elif hasattr(image_file_1, 'read'):
                # File-like object
                image_data_1 = image_file_1.read()
            else:
                raise ValueError("Неверный формат данных изображения 1")

            if hasattr(image_file_2, 'file'):
                # aiohttp FileField
                image_data_2 = image_file_2.file.read()
            elif hasattr(image_file_2, 'read'):
                # File-like object
                image_data_2 = image_file_2.read()
            else:
                raise ValueError("Неверный формат данных изображения 2")

            
            
            if hasattr(mask_file_1, 'file'):
                mask_data_1 = mask_file_1.file.read()
            elif hasattr(mask_file_1, 'read'):
                mask_data_1 = mask_file_1.read()
            else:
                raise ValueError("Неверный формат данных маски 1")

            if hasattr(mask_file_2, 'file'):
                mask_data_2 = mask_file_2.file.read()
            elif hasattr(mask_file_2, 'read'):
                mask_data_2 = mask_file_2.read()
            else:
                raise ValueError("Неверный формат данных маски 2")
            
            # Получаем дополнительные параметры
            #session_id = form_data.get('session_id')
            label = form_data.get('label')
            if label:
                try:
                    label = int(label)
                except (ValueError, TypeError):
                    label = None

            session_id = 1
            # Обрабатываем запрос
            res_1 = await process_radiomics_request(
                image_data=image_data_1,
                mask_data=mask_data_1,
                session_id=session_id,
                label=label
            )

            session_id = 2
            res_2 = await process_radiomics_request(
                image_data=image_data_2,
                mask_data=mask_data_2,
                session_id=session_id,
                label=label
            )
            ai_text = get_ai_result(res_1["path"], res_2["path"])
            """
            elif 'application/json' in content_type:
            # JSON запрос (для обратной совместимости с base64)
            data = await request.json()

            # Проверяем, это base64 или уже бинарные данные
            image_b64 = data.get('image')
            mask_b64 = data.get('mask')

            if image_b64 and mask_b64:
                # Декодируем base64
                try:
                    image_data = base64.b64decode(image_b64)
                    mask_data = base64.b64decode(mask_b64)
                except Exception as e:
                    raise ValueError(f"Ошибка декодирования base64: {str(e)}")

                result = await process_radiomics_request(
                    image_data=image_data,
                    mask_data=mask_data,
                    session_id=data.get('session_id'),
                    label=data.get('label')
                )
            else:
                raise ValueError("Отсутствуют данные изображения или маски в JSON")
            """
        else:
            raise ValueError(f"Неподдерживаемый Content-Type: {content_type}. Используйте multipart/form-data или application/json")

        return web.json_response({
                'status': 'success',
                'result': ai_text
            }, status=200)

    except ValueError as e:
        logger.error(f"Ошибка валидации: {str(e)}")
        return web.json_response({
            'status': 'error',
            'message': str(e)
        }, status=400)

    except FileNotFoundError as e:
        logger.error(f"Файл не найден: {str(e)}")
        return web.json_response({
            'status': 'error',
            'message': str(e)
        }, status=404)

    except Exception as e:
        logger.error(f"Ошибка обработки запроса: {str(e)}", exc_info=True)
        return web.json_response({
            'status': 'error',
            'message': f'Внутренняя ошибка сервера: {str(e)}'
        }, status=500)


async def handle_health(request: Request) -> Response:
    """
    Health check endpoint
    """
    return web.json_response({
        'status': 'ok',
        'service': 'radiomics-http-server',
        'timestamp': datetime.now().isoformat()
    })


async def handle_cors(request: Request) -> Response:
    """
    Обработчик для CORS preflight запросов
    """
    return web.Response(
        status=200,
        headers={
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        }
    )


def setup_cors(app):
    """
    Настройка CORS для всех запросов
    """
    @web.middleware
    async def cors_middleware(request, handler):
        # Handle preflight requests
        if request.method == 'OPTIONS':
            return await handle_cors(request)

        # Add CORS headers to all responses
        response = await handler(request)
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return response

    app.middlewares.append(cors_middleware)


def create_app():
    """
    Создает и настраивает приложение
    """
    # Увеличиваем максимальный размер тела запроса для больших файлов
    # client_max_size по умолчанию 1MB, увеличиваем до MAX_FILE_SIZE * 2 (для двух файлов)
    app = web.Application(client_max_size=MAX_FILE_SIZE * 2)

    # Настройка CORS
    setup_cors(app)

    # Регистрация маршрутов
    app.router.add_post('/radiomics', handle_radiomics)
    app.router.add_get('/health', handle_health)
    app.router.add_options('/{path:.*}', handle_cors)

    return app


async def main():
    """
    Запуск HTTP сервера
    """
    # Проверяем наличие конфигурационного файла
    if not os.path.exists(PARAMS_FILE):
        logger.error(f"Конфигурационный файл не найден: {PARAMS_FILE}")
        logger.error("Пожалуйста, убедитесь, что файл существует в текущей директории")
        raise FileNotFoundError(f"Конфигурационный файл не найден: {PARAMS_FILE}")

    app = create_app()

    logger.info(f"Запуск HTTP сервера на {HTTP_HOST}:{HTTP_PORT}")
    logger.info(f"Максимальный размер файла: {MAX_FILE_SIZE / 1024 / 1024} MB")
    logger.info(f"Максимальный размер запроса: {MAX_FILE_SIZE * 2 / 1024 / 1024} MB (для двух файлов)")
    logger.info(f"Downstream сервер: {DOWNSTREAM_SERVER_URL}")
    logger.info(f"Конфигурационный файл: {PARAMS_FILE}")
    logger.info("")
    logger.info("Доступные endpoints:")
    logger.info("  POST /radiomics - Извлечение радиомических признаков")
    logger.info("  GET  /health   - Health check")

    try:
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, HTTP_HOST, HTTP_PORT)
        await site.start()
        logger.info("Сервер запущен и ожидает запросов...")
        await asyncio.Future()  # Бесконечное ожидание
    except OSError as e:
        if e.errno == 48:  # Address already in use
            logger.error(f"Порт {HTTP_PORT} уже занят. Закройте другой процесс или используйте другой порт.")
        else:
            logger.error(f"Ошибка запуска сервера: {str(e)}", exc_info=True)
        raise
    except Exception as e:
        logger.error(f"Критическая ошибка при запуске сервера: {str(e)}", exc_info=True)
        raise


if __name__ == "__main__":
    asyncio.run(main())

