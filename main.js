const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const ini = require('ini');
const StandXAPI = require('./standx-api');

let mainWindow;
let standxAPI;

// INI 파일 경로 (실행 파일과 같은 폴더에 저장)
const configPath = app.isPackaged
  ? path.join(path.dirname(process.execPath), 'config.ini')  // 빌드된 앱
  : path.join(app.getAppPath(), 'config.ini');               // 개발 모드

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

  // 개발 모드
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC 핸들러
ipcMain.handle('init-api', async (event, config) => {
  try {
    standxAPI = new StandXAPI(config);
    return { success: true, message: 'API 초기화 완료' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('authenticate', async (event, { walletAddress, privateKey, chain }) => {
  try {
    standxAPI = new StandXAPI({ chain: chain || 'bsc' });
    const result = await standxAPI.authenticate(walletAddress, privateKey);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-ticker', async (event, symbol) => {
  try {
    const ticker = await standxAPI.getTicker(symbol);
    return { success: true, data: ticker };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-balance', async () => {
  try {
    const balance = await standxAPI.getBalance();
    return { success: true, data: balance };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-positions', async (event, symbol) => {
  try {
    const positions = await standxAPI.getPositions(symbol);
    return { success: true, data: positions };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-open-orders', async (event, symbol) => {
  try {
    const orders = await standxAPI.getOpenOrders(symbol);
    return { success: true, data: orders };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('place-order', async (event, orderData) => {
  try {
    const result = await standxAPI.placeOrder(orderData);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('cancel-order', async (event, orderId) => {
  try {
    const result = await standxAPI.cancelOrder(orderId);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('cancel-all-orders', async (event, symbol) => {
  try {
    const orders = await standxAPI.getOpenOrders(symbol);
    if (orders.result && orders.result.length > 0) {
      const orderIds = orders.result.map(o => o.id);
      const result = await standxAPI.cancelOrders(orderIds);
      return { success: true, data: result };
    }
    return { success: true, data: [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('change-leverage', async (event, { symbol, leverage }) => {
  try {
    const result = await standxAPI.changeLeverage(symbol, leverage);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('start-volume-bot', async (event, config) => {
  try {
    const result = await standxAPI.startVolumeBot(config);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-volume-bot', async () => {
  try {
    const result = await standxAPI.stopVolumeBot();
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
// 기존 코드에 추가

ipcMain.handle('get-points', async () => {
  try {
    const points = await standxAPI.getPoints();
    return { success: true, data: points };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('close-position', async (event, { symbol, size, side }) => {
  try {
    const result = await standxAPI.closePosition(symbol, size, side);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-token-balance', async (event, tokenAddress) => {
  try {
    const balance = await standxAPI.getTokenBalance(tokenAddress);
    return { success: true, data: balance };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-sushi-quote', async (event, { fromToken, toToken, amount }) => {
  try {
    const quote = await standxAPI.getSushiQuote(fromToken, toToken, amount);
    return { success: true, data: quote };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('execute-swap', async (event, { fromToken, toToken, amount }) => {
  try {
    const result = await standxAPI.executeSwap(fromToken, toToken, amount);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-bot-status', async () => {
  try {
    const status = standxAPI.getBotStatus();
    return { success: true, data: status };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// INI 파일 읽기
ipcMain.handle('load-config', async () => {
  try {
    if (fs.existsSync(configPath)) {
      const fileContent = fs.readFileSync(configPath, 'utf-8');
      const config = ini.parse(fileContent);
      return { success: true, data: config };
    }
    return { success: true, data: {} };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// INI 파일 저장
ipcMain.handle('save-config', async (event, config) => {
  try {
    const iniContent = ini.stringify(config);
    fs.writeFileSync(configPath, iniContent, 'utf-8');
    return { success: true, message: '설정이 저장되었습니다' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// INI 파일 경로 가져오기
ipcMain.handle('get-config-path', async () => {
  return { success: true, path: configPath };
});
