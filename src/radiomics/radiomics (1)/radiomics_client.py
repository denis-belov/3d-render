#!/usr/bin/env python3
"""
WebSocket клиент с поддержкой передачи больших файлов по частям
"""

import asyncio
import websockets
import json
import base64
import os
import sys
import logging
from datetime import datetime

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Конфигурация
SERVER_URI = 'ws://localhost:8765'
CHUNK_SIZE = 1024 * 1024  # 1 MB chunks


async def send_file_in_chunks(websocket, file_path, file_type):
    """
    Отправляет файл по частям
    
    Parameters:
    -----------
    websocket : websockets.WebSocketClientProtocol
        WebSocket соединение
    file_path : str
        Путь к файлу
    file_type : str
        Тип файла ('image' или 'mask')
    """
    file_size = os.path.getsize(file_path)
    filename = os.path.basename(file_path)
    
    # Вычисляем количество частей
    total_chunks = (file_size + CHUNK_SIZE - 1) // CHUNK_SIZE
    
    logger.info(f"Отправка {filename}: {file_size} bytes в {total_chunks} частях")
    
    with open(file_path, 'rb') as f:
        for chunk_idx in range(total_chunks):
            # Читаем chunk
            chunk_data = f.read(CHUNK_SIZE)
            chunk_b64 = base64.b64encode(chunk_data).decode('utf-8')
            
            # Отправляем chunk
            chunk_msg = {
                'type': 'file_chunk',
                'file_type': file_type,
                'chunk_index': chunk_idx,
                'total_chunks': total_chunks,
                'data': chunk_b64
            }
            
            await websocket.send(json.dumps(chunk_msg))
            
            # Ждем подтверждения
            response_raw = await websocket.recv()
            response = json.loads(response_raw)
            
            if response.get('status') == 'receiving':
                progress = response.get('progress', 0)
                logger.info(f"  {filename}: {progress:.1f}% отправлено")
    
    logger.info(f"{filename} отправлен полностью")


async def send_files_for_processing(image_path, mask_path):
    """
    Отправляет файлы на сервер для обработки
    """
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Файл изображения не найден: {image_path}")
    if not os.path.exists(mask_path):
        raise FileNotFoundError(f"Файл маски не найден: {mask_path}")
    
    logger.info(f"Подключение к серверу {SERVER_URI}...")
    
    # Увеличиваем max_size для клиента
    async with websockets.connect(
        SERVER_URI,
        max_size=100 * 1024 * 1024,  # 100 MB
        ping_interval=20,
        ping_timeout=60
    ) as websocket:
        logger.info("Подключение установлено")
        
        # Получаем информацию о файлах
        image_size = os.path.getsize(image_path)
        mask_size = os.path.getsize(mask_path)
        
        session_id = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Отправляем начальный запрос с метаданными
        initial_message = {
            'type': 'radiomics_request',
            'session_id': session_id,
            'image_info': {
                'filename': os.path.basename(image_path),
                'size': image_size,
                'total_chunks': (image_size + CHUNK_SIZE - 1) // CHUNK_SIZE
            },
            'mask_info': {
                'filename': os.path.basename(mask_path),
                'size': mask_size,
                'total_chunks': (mask_size + CHUNK_SIZE - 1) // CHUNK_SIZE
            }
        }
        
        logger.info(f"Отправка метаданных (session_id: {session_id})...")
        await websocket.send(json.dumps(initial_message))
        
        # Ждем подтверждения
        response_raw = await websocket.recv()
        response = json.loads(response_raw)
        logger.info(f"[{response.get('status').upper()}] {response.get('message')}")
        
        # Ждем готовности принять изображение
        response_raw = await websocket.recv()
        response = json.loads(response_raw)
        logger.info(f"[{response.get('status').upper()}] {response.get('message')}")
        
        # Отправляем изображение
        await send_file_in_chunks(websocket, image_path, 'image')
        
        # Ждем готовности принять маску
        response_raw = await websocket.recv()
        response = json.loads(response_raw)
        logger.info(f"[{response.get('status').upper()}] {response.get('message')}")
        
        # Отправляем маску
        await send_file_in_chunks(websocket, mask_path, 'mask')
        
        # Ожидаем ответы от сервера
        logger.info("Файлы отправлены, ожидание обработки...")
        
        while True:
            try:
                response_raw = await asyncio.wait_for(websocket.recv(), timeout=300.0)
                response = json.loads(response_raw)
                
                status = response.get('status')
                message = response.get('message', '')
                
                logger.info(f"[{status.upper()}] {message}")
                
                if status in ['finished', 'error', 'warning']:
                    break
                    
            except asyncio.TimeoutError:
                logger.error("Тайм-аут ожидания ответа от сервера")
                break
            except websockets.exceptions.ConnectionClosed:
                logger.warning("Соединение закрыто сервером")
                break


async def main():
   
    image_path = '1.3.12.2.1107.5.1.4.11049.30000022021705353895800005227.nii'
    mask_path = '1_3_12_2_1107_5_1_4_11049_30000022021705353895800005227_segmentation.nii'
    
    try:
        await send_files_for_processing(image_path, mask_path)
        logger.info("Обработка завершена успешно")
    except Exception as e:
        logger.error(f"Ошибка: {str(e)}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
