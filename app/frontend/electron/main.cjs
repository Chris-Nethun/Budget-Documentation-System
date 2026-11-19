const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const isPackaged = app.isPackaged;
const projectDir = path.resolve(__dirname, '..', '..');
const dataSourceDir = isPackaged
  ? path.join(process.resourcesPath, 'budget-data')
  : projectDir;
const dataDir = isPackaged ? app.getPath('userData') : projectDir;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let pythonRequestQueue = Promise.resolve();

async function prepareDataDirectory() {
  fs.mkdirSync(dataDir, { recursive: true });

  for (const file of ['backend.py', 'budget_loader.py', 'desktop_api.py']) {
    const source = path.join(dataSourceDir, file);
    const destination = path.join(dataDir, file);
    if (source !== destination) fs.copyFileSync(source, destination);
  }

  for (const file of [
    'budget.csv',
    'budgets_extracted.json',
    'VoucherTemplate.docx',
    'CoverLetterTemplate.docx',
  ]) {
    const destination = path.join(dataDir, file);
    if (!fs.existsSync(destination)) {
      fs.copyFileSync(path.join(dataSourceDir, file), destination);
    }
  }

  const previousServer = path.join(dataDir, 'server.py');
  if (isPackaged && fs.existsSync(previousServer)) fs.unlinkSync(previousServer);

  const outputDir = path.join(dataDir, 'Output');
  fs.mkdirSync(outputDir, { recursive: true });

  const databasePath = path.join(dataDir, 'database.xlsx');
  if (!fs.existsSync(databasePath)) {
    const selection = await dialog.showOpenDialog({
      title: 'Select the budget database workbook',
      properties: ['openFile'],
      filters: [{ name: 'Excel workbooks', extensions: ['xlsx'] }],
    });
    if (selection.canceled || selection.filePaths.length === 0) {
      throw new Error('A database workbook is required to use the application.');
    }
    fs.copyFileSync(selection.filePaths[0], databasePath);
  }
}

function invokePython(request) {
  return new Promise((resolve, reject) => {
    const python = process.env.BUDGET_PYTHON || 'python';
    const child = spawn(python, [path.join(dataDir, 'desktop_api.py')], {
      cwd: dataDir,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => reject(new Error(`Could not start Python: ${error.message}`)));
    child.on('close', (code) => {
      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        reject(new Error(code !== 0
          ? stderr.trim() || `Python exited with code ${code}`
          : `Python returned invalid output${stderr ? `: ${stderr.trim()}` : ''}`));
        return;
      }
      if (code !== 0 && result.status !== 'error') {
        reject(new Error(stderr.trim() || `Python exited with code ${code}`));
        return;
      }
      resolve(result);
    });

    child.stdin.end(JSON.stringify(request));
  });
}

ipcMain.handle('budget:request', (_event, request) => {
  const operation = pythonRequestQueue.then(() => invokePython(request));
  pythonRequestQueue = operation.catch(() => {});
  return operation;
});
ipcMain.handle('budget:open-file', async (_event, name, reveal) => {
  if (typeof name !== 'string' || path.basename(name) !== name) {
    throw new Error('Invalid document name.');
  }
  const filePath = path.join(dataDir, 'Output', name);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error('Document not found.');
  }
  if (reveal) {
    shell.showItemInFolder(filePath);
    return;
  }
  const error = await shell.openPath(filePath);
  if (error) throw new Error(error);
});
ipcMain.handle('budget:show-database', () => {
  const databasePath = path.join(dataDir, 'database.xlsx');
  if (!fs.existsSync(databasePath) || !fs.statSync(databasePath).isFile()) {
    throw new Error('Database workbook not found.');
  }
  shell.showItemInFolder(databasePath);
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  try {
    await prepareDataDirectory();
  } catch (error) {
    dialog.showErrorBox('Unable to start', error.message);
    app.quit();
    return;
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
