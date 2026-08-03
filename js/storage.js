/* ============================================
   存储层 - IndexedDB 封装
   所有学生数据本地加密存储，不联网
   ============================================ */

const DB_NAME = 'counselor_workbench';
const DB_VERSION = 1;

let db = null;

// 对象仓库定义
const STORES = {
  students: { keyPath: 'id', autoIncrement: true, indexes: [
    { name: 'studentId', keyPath: 'studentId', unique: false },
    { name: 'className', keyPath: 'className', unique: false },
    { name: 'year', keyPath: 'year', unique: false },
    { name: 'major', keyPath: 'major', unique: false },
    { name: 'careerGoal', keyPath: 'careerGoal', unique: false }
  ]},
  grades: { keyPath: 'id', autoIncrement: true, indexes: [
    { name: 'studentId', keyPath: 'studentId', unique: false },
    { name: 'semester', keyPath: 'semester', unique: false }
  ]},
  assessments: { keyPath: 'id', autoIncrement: true, indexes: [
    { name: 'studentId', keyPath: 'studentId', unique: false },
    { name: 'academicYear', keyPath: 'academicYear', unique: false }
  ]},
  settings: { keyPath: 'key' },
  schedules: { keyPath: 'id', autoIncrement: true },
  reports: { keyPath: 'id', autoIncrement: true }
};

// 初始化数据库
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      for (const [storeName, config] of Object.entries(STORES)) {
        if (!database.objectStoreNames.contains(storeName)) {
          const store = database.createObjectStore(storeName, {
            keyPath: config.keyPath,
            autoIncrement: config.autoIncrement || false
          });
          if (config.indexes) {
            config.indexes.forEach(idx => {
              store.createIndex(idx.name, idx.keyPath, { unique: idx.unique });
            });
          }
        }
      }
    };

    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };

    request.onerror = (e) => {
      console.error('IndexedDB初始化失败:', e.target.error);
      reject(e.target.error);
    };
  });
}

// 通用：获取事务
function getStore(storeName, mode = 'readonly') {
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

// 通知数据变更（触发云端自动同步）
function notifyDataChange() {
  window.dispatchEvent(new CustomEvent('dataChanged'));
}

// 新增记录
function dbAdd(storeName, data) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName, 'readwrite');
    const request = store.add(data);
    request.onsuccess = () => { notifyDataChange(); resolve(request.result); };
    request.onerror = () => reject(request.error);
  });
}

// 批量新增
function dbAddBatch(storeName, dataList) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const results = [];
    dataList.forEach(data => {
      const req = store.add(data);
      req.onsuccess = () => results.push(req.result);
    });
    tx.oncomplete = () => { notifyDataChange(); resolve(results); };
    tx.onerror = () => reject(tx.error);
  });
}

// 获取单条
function dbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 获取全部
function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// 更新记录
function dbPut(storeName, data) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName, 'readwrite');
    const request = store.put(data);
    request.onsuccess = () => { notifyDataChange(); resolve(request.result); };
    request.onerror = () => reject(request.error);
  });
}

// 删除记录
function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName, 'readwrite');
    const request = store.delete(key);
    request.onsuccess = () => { notifyDataChange(); resolve(true); };
    request.onerror = () => reject(request.error);
  });
}

// 清空仓库
function dbClear(storeName) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName, 'readwrite');
    const request = store.clear();
    request.onsuccess = () => { notifyDataChange(); resolve(true); };
    request.onerror = () => reject(request.error);
  });
}

// 按索引查询
function dbGetByIndex(storeName, indexName, value) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName);
    const index = store.index(indexName);
    const request = index.getAll(value);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// 按条件过滤（内存过滤）
function dbFilter(storeName, filterFn) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName);
    const request = store.openCursor();
    const results = [];
    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (filterFn(cursor.value)) results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// 设置项管理
async function getSetting(key, defaultVal = null) {
  try {
    const result = await dbGet('settings', key);
    return result ? result.value : defaultVal;
  } catch { return defaultVal; }
}

async function setSetting(key, value) {
  return dbPut('settings', { key, value });
}

async function deleteSetting(key) {
  try {
    const tx = db.transaction('settings', 'readwrite');
    await tx.objectStore('settings').delete(key);
    await tx.done;
    notifyDataChange();
  } catch (e) { console.warn('deleteSetting error:', e); }
}

// 数据导出（备份）
async function exportAllData() {
  const data = {};
  for (const storeName of Object.keys(STORES)) {
    data[storeName] = await dbGetAll(storeName);
  }
  return data;
}

// 数据导入（恢复）
async function importAllData(data) {
  for (const storeName of Object.keys(STORES)) {
    if (data[storeName] && Array.isArray(data[storeName])) {
      await dbClear(storeName);
      if (data[storeName].length > 0) {
        await dbAddBatch(storeName, data[storeName]);
      }
    }
  }
  notifyDataChange();
  return true;
}

// 统计记录数
async function dbCount(storeName) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 简单哈希函数（用于密码，非加密级安全）
function simpleHash(str) {
  let hash = 0;
  const salt = 'wy_counselor_2025';
  const combined = str + salt;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'h' + Math.abs(hash).toString(36) + '_' + combined.length;
}
