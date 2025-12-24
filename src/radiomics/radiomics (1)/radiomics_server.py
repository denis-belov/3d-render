#!/usr/bin/env python3
"""
WebSocket сервер для извлечения радиомических признаков (поддержка больших файлов)
"""

import asyncio
import websockets
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
import aiofiles

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Конфигурация
WEBSOCKET_HOST = '0.0.0.0'
WEBSOCKET_PORT = 8765
PARAMS_FILE = 'EV_rad.yaml'
DOWNSTREAM_SERVER_URL = 'http://localhost:8080/upload'  # Изменил на localhost
MAX_MESSAGE_SIZE = 100 * 1024 * 1024  # 100 MB
CHUNK_SIZE = 1024 * 1024  # 1 MB chunks


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


async def send_to_downstream_server(csv_path, session_id):
    """
    Отправляет CSV файл на следующий сервер
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


async def receive_chunked_file(websocket, file_info):
    """
    Получает файл по частям (chunks)
    """
    total_size = file_info['size']
    total_chunks = file_info['total_chunks']
    file_data = b''
    
    logger.info(f"Получение файла {file_info['filename']}: {total_size} bytes в {total_chunks} частях")
    
    for chunk_idx in range(total_chunks):
        chunk_raw = await websocket.recv()
        chunk_msg = json.loads(chunk_raw)
        
        if chunk_msg['type'] != 'file_chunk':
            raise ValueError(f"Ожидался file_chunk, получен {chunk_msg['type']}")
        
        chunk_data = base64.b64decode(chunk_msg['data'])
        file_data += chunk_data
        
        # Отправляем прогресс
        progress = (chunk_idx + 1) / total_chunks * 100
        await websocket.send(json.dumps({
            'status': 'receiving',
            'filename': file_info['filename'],
            'progress': round(progress, 1)
        }))
    
    logger.info(f"Файл {file_info['filename']} получен полностью ({len(file_data)} bytes)")
    return file_data


async def process_radiomics_request(websocket, message):
    """
    Обрабатывает запрос на извлечение радиомических признаков
    """
    session_id = message.get('session_id', datetime.now().strftime('%Y%m%d_%H%M%S'))
    logger.info(f"[{session_id}] Начало обработки запроса")
    
    with tempfile.TemporaryDirectory() as temp_dir:
        try:
            # Отправляем подтверждение
            await websocket.send(json.dumps({
                'status': 'received',
                'session_id': session_id,
                'message': 'Запрос получен, ожидаем файлы'
            }))
            
            # Получаем информацию о файлах
            image_info = message.get('image_info')
            mask_info = message.get('mask_info')
            
            logger.info(f"[{session_id}] Ожидается изображение: {image_info['filename']} ({image_info['size']} bytes)")
            logger.info(f"[{session_id}] Ожидается маска: {mask_info['filename']} ({mask_info['size']} bytes)")
            
            # Получаем файл изображения
            await websocket.send(json.dumps({
                'status': 'ready',
                'message': 'Готов принять файл изображения'
            }))
            
            image_data = await receive_chunked_file(websocket, image_info)
            image_path = os.path.join(temp_dir, f'image_{session_id}.nii')
            with open(image_path, 'wb') as f:
                f.write(image_data)
            
            # Получаем файл маски
            await websocket.send(json.dumps({
                'status': 'ready',
                'message': 'Готов принять файл маски'
            }))
            
            mask_data = await receive_chunked_file(websocket, mask_info)
            mask_path = os.path.join(temp_dir, f'mask_{session_id}.nii')
            with open(mask_path, 'wb') as f:
                f.write(mask_data)
            
            logger.info(f"[{session_id}] Оба файла получены и сохранены")
            
            # Начинаем обработку
            await websocket.send(json.dumps({
                'status': 'processing',
                'session_id': session_id,
                'message': 'Извлечение радиомических признаков...'
            }))
            
            # Извлекаем признаки
            features = extract_radiomics_features(
                image_path,
                mask_path,
                PARAMS_FILE,
                label=None
            )
            
            # Преобразуем в DataFrame
            df = features_to_dataframe(features)
            df.insert(0, 'session_id', session_id)
            df.insert(1, 'timestamp', datetime.now().isoformat())
            
            # Сохраняем в CSV
            csv_filename = f'radiomics_features_{session_id}.csv'
            csv_path = os.path.join(temp_dir, csv_filename)
            df.to_csv(csv_path, index=False)
            
            logger.info(f"[{session_id}] Признаки извлечены и сохранены в {csv_filename}")
            
            await websocket.send(json.dumps({
                'status': 'completed',
                'session_id': session_id,
                'message': f'Извлечено {len(df.columns)} признаков',
                'features_count': len(df.columns)
            }))
            
            # Отправляем на downstream сервер
            logger.info(f"[{session_id}] Отправка результатов на downstream сервер...")
            await websocket.send(json.dumps({
                'status': 'uploading',
                'session_id': session_id,
                'message': 'Отправка результатов на следующий сервер...'
            }))
            
            success = await send_to_downstream_server(csv_path, session_id)
            
            if success:
                await websocket.send(json.dumps({
                    'status': 'finished',
                    'session_id': session_id,
                    'message': 'Обработка завершена, результаты отправлены'
                }))
            else:
                await websocket.send(json.dumps({
                    'status': 'warning',
                    'session_id': session_id,
                    'message': 'Обработка завершена, но не удалось отправить на downstream сервер'
                }))
            
        except Exception as e:
            logger.error(f"[{session_id}] Ошибка обработки: {str(e)}", exc_info=True)
            await websocket.send(json.dumps({
                'status': 'error',
                'session_id': session_id,
                'message': f'Ошибка: {str(e)}'
            }))


async def handler(websocket, path):
    """
    Обработчик WebSocket соединений
    """
    client_address = websocket.remote_address
    logger.info(f"Новое подключение от {client_address}")
    
    try:
        async for message_raw in websocket:
            try:
                logger.info(f"Получено сообщение размером {len(message_raw)} bytes")
                
                # Парсим JSON
                message = json.loads(message_raw)
                logger.info(f"Тип сообщения: {message.get('type')}")
                
                if message.get('type') == 'radiomics_request':
                    await process_radiomics_request(websocket, message)
                else:
                    await websocket.send(json.dumps({
                        'status': 'error',
                        'message': f'Неизвестный тип запроса: {message.get("type")}'
                    }))
                    
            except json.JSONDecodeError as e:
                logger.error(f"Ошибка декодирования JSON: {str(e)}")
                await websocket.send(json.dumps({
                    'status': 'error',
                    'message': f'Невалидный JSON: {str(e)}'
                }))
            except Exception as e:
                logger.error(f"Ошибка обработки сообщения: {str(e)}", exc_info=True)
                await websocket.send(json.dumps({
                    'status': 'error',
                    'message': f'Ошибка обработки: {str(e)}'
                }))
                
    except websockets.exceptions.ConnectionClosed:
        logger.info(f"Клиент {client_address} отключился")
    except Exception as e:
        logger.error(f"Ошибка соединения с {client_address}: {str(e)}", exc_info=True)


async def main():
    """
    Запуск WebSocket сервера
    """
    logger.info(f"Запуск WebSocket сервера на {WEBSOCKET_HOST}:{WEBSOCKET_PORT}")
    logger.info(f"Максимальный размер сообщения: {MAX_MESSAGE_SIZE / 1024 / 1024} MB")
    logger.info(f"Downstream сервер: {DOWNSTREAM_SERVER_URL}")
    logger.info(f"Конфигурационный файл: {PARAMS_FILE}")
    
    # Увеличиваем max_size для поддержки больших файлов
    async with websockets.serve(
        handler, 
        WEBSOCKET_HOST, 
        WEBSOCKET_PORT,
        max_size=MAX_MESSAGE_SIZE,
        ping_interval=20,
        ping_timeout=60
    ):
        logger.info("Сервер запущен и ожидает подключений...")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
