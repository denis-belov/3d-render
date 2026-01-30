import generateMesh from '../js/mc';

onmessage = async message => postMessage(generateMesh(message.data));
