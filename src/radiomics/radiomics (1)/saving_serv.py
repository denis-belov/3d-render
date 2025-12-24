#!/usr/bin/env python3
"""
Downstream сервер для приема и дальнейшей обработки CSV файлов
"""

from aiohttp import web
import logging
import os
from datetime import datetime

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Конфигурация
UPLOAD_DIR = 'received_results'
HOST = '0.0.0.0'
PORT = 8080


async def handle_upload(request):
    """
    Обработчик загрузки CSV файлов
    """
    try:
        # Читаем multipart данные
        reader = await request.multipart()
        
        session_id = None
        csv_data = None
        filename = None
        
        async for field in reader:
            if field.name == 'session_id':
                session_id = await field.text()
            elif field.name == 'file':
                filename = field.filename
                csv_data = await field.read()
        
        if not csv_data:
            return web.json_response(
                {'error': 'Файл не найден'},
                status=400
            )
        
        # Создаем директорию если не существует
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        
        # Сохраняем файл
        if not filename:
            filename = f'results_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'
        
        filepath = os.path.join(UPLOAD_DIR, filename)
        
        with open(filepath, 'wb') as f:
            f.write(csv_data)
        
        logger.info(f"Получен файл: {filename} (session_id: {session_id})")
        logger.info(f"Сохранен в: {filepath}")
        
        # Здесь можно добавить дальнейшую обработку CSV файла
        # Например, загрузку в базу данных, анализ и т.д.
        
        return web.json_response({
            'status': 'success',
            'message': 'Файл получен и сохранен',
            'session_id': session_id,
            'filename': filename,
            'filepath': filepath
        })
        
    except Exception as e:
        logger.error(f"Ошибка при обработке загрузки: {str(e)}")
        return web.json_response(
            {'error': str(e)},
            status=500
        )


async def handle_health(request):
    """
    Health check endpoint
    """
    return web.json_response({
        'status': 'ok',
        'timestamp': datetime.now().isoformat()
    })


def main():
    """
    Запуск downstream сервера
    """
    app = web.Application()
    app.router.add_post('/upload', handle_upload)
    app.router.add_get('/health', handle_health)
    
    logger.info(f"Запуск downstream сервера на {HOST}:{PORT}")
    logger.info(f"Директория для сохранения: {UPLOAD_DIR}")
    
    web.run_app(app, host=HOST, port=PORT)


if __name__ == "__main__":
    main()
