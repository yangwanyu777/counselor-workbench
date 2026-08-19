/* ============================================
   琬钰老师的辅导员工作台 - 主应用逻辑
   ============================================ */

// ========== 全局状态 ==========
const state = {
  currentModule: 'dashboard',
  students: [],
  filteredStudents: [],
  selectedStudentIds: new Set(),
  grades: [],
  assessments: [],
  currentPage: 1,
  pageSize: 20,
  filterConditions: {},
  charts: {},
  editingStudentId: null,
  fileImportCallback: null,
  studentFields: [],      // 学生字段配置（动态）
  studentListColumns: []  // 学生总览表显示列（动态）
};

// ========== 动态字段系统配置 ==========

// 核心固定字段（不能删除/重命名，但可以显示/隐藏）
const CORE_FIELDS = ['studentId', 'name'];

// 系统内部字段（完全不显示在页面上）
const SYSTEM_FIELDS = ['id', 'createdAt', 'updatedAt'];

// 常用字段中文映射（遇到这些列名自动识别）
const FIELD_NAME_MAP = {
  'studentId': '学号',
  'name': '姓名',
  'gender': '性别',
  'sex': '性别',
  'ethnicity': '民族',
  'nation': '民族',
  'birthDate': '出生日期',
  'birthday': '出生日期',
  'gradeLevel': '学历层次',
  'education': '学历层次',
  'year': '年级',
  'grade': '年级',
  'major': '专业',
  'majorName': '专业',
  'className': '班级',
  'class': '班级',
  'administrativeClass': '班级',
  'phone': '联系方式',
  'mobile': '联系方式',
  'contact': '联系方式',
  'address': '家庭住址',
  'homeAddress': '家庭住址',
  'careerGoal': '生涯规划目标',
  'career': '生涯规划目标',
  'plan': '生涯规划目标',
  'politicalStatus': '政治面貌',
  'party': '政治面貌',
  'idCard': '身份证号',
  'idNumber': '身份证号',
  'email': '电子邮箱',
  'qq': 'QQ号',
  'wechat': '微信号',
  'dormitory': '宿舍号',
  'room': '宿舍号',
  'nativePlace': '籍贯',
  'origin': '籍贯',
  'enrollmentDate': '入学日期',
  'graduationDate': '预计毕业日期',
  'highSchool': '毕业中学',
  'parentName': '家长姓名',
  'parentPhone': '家长联系方式',
  'fatherName': '父亲姓名',
  'fatherPhone': '父亲联系方式',
  'motherName': '母亲姓名',
  'motherPhone': '母亲联系方式',
  'emergencyContact': '紧急联系人',
  'emergencyPhone': '紧急联系电话',
  'studentStatus': '学籍状态',
  'status': '学籍状态',
  '备注': '备注',
  'note': '备注',
  'notes': '备注'
};

// 默认总览表显示列（新增父母联系方式默认显示）
const DEFAULT_LIST_COLUMNS = ['studentId', 'name', 'gender', 'year', 'major', 'className', 'ethnicity', 'gradeLevel', 'careerGoal', 'phone', 'fatherPhone', 'motherPhone'];

// 字段分组（用于详情页展示）
const FIELD_GROUPS = {
  '基本信息': ['studentId', 'name', 'gender', 'ethnicity', 'birthDate', 'politicalStatus', 'idCard'],
  '学籍信息': ['gradeLevel', 'year', 'major', 'className', 'studentStatus', 'enrollmentDate', 'graduationDate'],
  '联系方式': ['phone', 'email', 'qq', 'wechat', 'address', 'dormitory'],
  '家庭信息': ['parentName', 'parentPhone', 'fatherName', 'fatherPhone', 'motherName', 'motherPhone', 'emergencyContact', 'emergencyPhone', 'nativePlace', 'highSchool'],
  '生涯发展': ['careerGoal'],
  '其他信息': []
};

// 字段类型推断
function detectFieldType(key, values) {
  if (['gender', 'sex', 'ethnicity', 'nation', 'politicalStatus', 'gradeLevel', 'careerGoal', 'studentStatus'].includes(key)) return 'select';
  if (['birthDate', 'enrollmentDate', 'graduationDate'].includes(key)) return 'date';
  const nonEmpty = values.filter(v => v !== '' && v != null);
  if (nonEmpty.length === 0) return 'text';
  const allNumbers = nonEmpty.every(v => !isNaN(parseFloat(v)) && isFinite(v));
  if (allNumbers) return 'number';
  return 'text';
}

// 标准化学号（去除所有空白，统一为字符串）
function normalizeStudentId(id) {
  if (id == null || id === '') return '';
  return String(id).replace(/[\s\u00A0\u200B-\u200D\uFEFF]+/g, '').trim();
}

// 让出主线程，防止大数据量循环阻塞 UI
function yieldToMain() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// 清理列名（去除所有空白和不可见字符）
function cleanColumnName(name) {
  return String(name ?? '')
    .replace(/[\s\u00A0\u200B-\u200D\uFEFF]+/g, '')
    .replace(/^[^\u4e00-\u9fa5a-zA-Z0-9_]+/g, '')
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9_]+$/g, '')
    .trim();
}

// 从列名推断字段key
function columnToFieldKey(columnName) {
  const lower = cleanColumnName(columnName);
  if (!lower) return 'custom_unknown';

  // 1. 先检查精确规则匹配（最具体，如"父亲联系方式"优先于"联系方式"）
  const rules = [
    [/^(学号|考号|编号|学籍号)$/, 'studentId'],
    [/学号|学籍|考号|考生号|编号/i, 'studentId'],
    [/^(姓名|学生姓名|名字)$/, 'name'],
    [/^(性别|男女)$/, 'gender'],
    [/^(民族|族别)$/, 'ethnicity'],
    [/^(出生日期|生日|出生年月)$/, 'birthDate'],
    [/^(学历层次|学历|培养层次|层次)$/, 'gradeLevel'],
    [/^(年级|入学年份|届)$/, 'year'],
    [/^(专业|专业名称)$/, 'major'],
    [/^(班级|行政班|教学班)$/, 'className'],
    [/^(手机|电话|联系方式|手机号|联系电话|本人电话|本人联系方式|本人手机)$/, 'phone'],
    [/^(家庭住址|住址|地址|家庭地址|现住址)$/, 'address'],
    [/^(生涯规划|生涯目标|规划目标|职业规划|毕业意向|生涯规划信息|生涯规划目标)$/, 'careerGoal'],
    [/^(政治面貌|党派)$/, 'politicalStatus'],
    [/^(身份证号|身份证|证件号)$/, 'idCard'],
    [/^(邮箱|电子邮箱|邮件)$/, 'email'],
    [/^(QQ)$/, 'qq'],
    [/^(微信|微信号)$/, 'wechat'],
    [/^(宿舍|寝室|房间号)$/, 'dormitory'],
    [/^(籍贯|生源地)$/, 'nativePlace'],
    [/^(入学日期|入学时间)$/, 'enrollmentDate'],
    [/^(预计毕业|毕业日期|离校时间)$/, 'graduationDate'],
    [/^(毕业中学|高中)$/, 'highSchool'],
    [/^(父亲联系方式|父亲电话|父亲手机|父亲手机号|父亲联系电话|爸爸联系方式|爸爸电话|爸爸手机)$/, 'fatherPhone'],
    [/^(母亲联系方式|母亲电话|母亲手机|母亲手机号|母亲联系电话|妈妈联系方式|妈妈电话|妈妈手机)$/, 'motherPhone'],
    [/^(父亲姓名|父亲名字|爸爸姓名)$/, 'fatherName'],
    [/^(母亲姓名|母亲名字|妈妈姓名)$/, 'motherName'],
    [/^(家长姓名|监护人姓名)$/, 'parentName'],
    [/^(家长电话|家长联系方式|家长手机|监护人电话)$/, 'parentPhone'],
    [/^(紧急联系人|紧急联系人姓名)$/, 'emergencyContact'],
    [/^(紧急联系电话|紧急电话)$/, 'emergencyPhone'],
    [/^(学籍状态|在读状态|状态)$/, 'studentStatus'],
    [/^(备注|说明|备注信息)$/, 'notes']
  ];
  for (const [regex, key] of rules) {
    if (regex.test(lower)) return key;
  }

  // 2. 再检查 FIELD_NAME_MAP 精确匹配
  for (const [key, names] of Object.entries(FIELD_NAME_MAP)) {
    if (typeof names === 'string' && lower === names) return key;
  }

  // 3. 最后检查 FIELD_NAME_MAP 模糊匹配（includes）
  for (const [key, names] of Object.entries(FIELD_NAME_MAP)) {
    if (typeof names === 'string' && names.length >= 3 && lower.includes(names)) return key;
  }

  // 4. 未知列名：使用安全的自定义 key
  const safeKey = lower.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').substring(0, 50);
  return safeKey ? 'custom_' + safeKey : 'custom_unknown';
}

// 获取字段显示名
function getFieldDisplayName(key) {
  if (FIELD_NAME_MAP[key]) return FIELD_NAME_MAP[key];
  if (key.startsWith('custom_')) return key.replace('custom_', '');
  return key;
}

// 加载字段配置
async function loadStudentFieldConfig() {
  const savedFields = await getSetting('studentFields');
  const savedColumns = await getSetting('studentListColumns');
  const configVersion = await getSetting('fieldConfigVersion');

  // V4 迁移：清除旧的字段配置，重新识别所有字段并自动显示父母联系方式等字段
  if (!configVersion || configVersion < 4) {
    state.studentFields = [];
    state.studentListColumns = [];
    await setSetting('fieldConfigVersion', 4);
    await saveStudentFieldConfig();
  } else {
    state.studentFields = savedFields || [];
    state.studentListColumns = savedColumns || [];
  }
}

// 保存字段配置
async function saveStudentFieldConfig() {
  await setSetting('studentFields', state.studentFields);
  await setSetting('studentListColumns', state.studentListColumns);
}

// 同步字段配置（从所有学生数据中提取）
async function syncStudentFields(students) {
  const existingMap = {};
  state.studentFields.forEach(f => { existingMap[f.key] = f; });

  // 收集每个字段的所有值
  const fieldValues = {};
  students.forEach(s => {
    Object.keys(s).forEach(key => {
      if (SYSTEM_FIELDS.includes(key)) return;
      if (!fieldValues[key]) fieldValues[key] = [];
      fieldValues[key].push(s[key]);
    });
  });

  const newFields = [];

  // 先确保核心字段存在
  CORE_FIELDS.forEach(key => {
    const existing = existingMap[key];
    newFields.push({
      key,
      name: existing?.name || getFieldDisplayName(key),
      system: true,
      core: true,
      type: 'text',
      filterable: existing?.filterable !== undefined ? existing.filterable : true,
      showInList: existing?.showInList !== undefined ? existing.showInList : true
    });
  });

  // 其他字段
  Object.keys(fieldValues).forEach(key => {
    if (CORE_FIELDS.includes(key)) return;
    const existing = existingMap[key];
    const values = fieldValues[key];
    newFields.push({
      key,
      name: existing?.name || getFieldDisplayName(key),
      system: false,
      core: false,
      type: existing?.type || detectFieldType(key, values),
      filterable: existing?.filterable !== undefined ? existing.filterable : true,
      showInList: existing?.showInList !== undefined ? existing.showInList : state.studentListColumns.includes(key)
    });
  });

  // 按默认列顺序 + 其他字段字母顺序排序
  const orderMap = {};
  DEFAULT_LIST_COLUMNS.forEach((k, i) => orderMap[k] = i);
  newFields.sort((a, b) => {
    const oa = orderMap[a.key] !== undefined ? orderMap[a.key] : 1000;
    const ob = orderMap[b.key] !== undefined ? orderMap[b.key] : 1000;
    // 核心字段始终排在最前面
    if (a.core && !b.core) return -1;
    if (b.core && !a.core) return 1;
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  state.studentFields = newFields;

  // 同步列表列：核心字段始终显示
  if (!state.studentListColumns.includes('studentId')) state.studentListColumns.unshift('studentId');
  if (!state.studentListColumns.includes('name')) {
    const idx = state.studentListColumns.indexOf('studentId');
    state.studentListColumns.splice(idx + 1, 0, 'name');
  }

  // 新发现的字段（之前不在 existingMap 中的）自动加入列表显示
  newFields.forEach(f => {
    if (!state.studentListColumns.includes(f.key) && !existingMap[f.key]) {
      state.studentListColumns.push(f.key);
    }
  });

  // 父母联系方式类字段强制默认显示（如果数据中存在）
  const familyContactFields = ['fatherPhone', 'motherPhone', 'parentPhone', 'fatherName', 'motherName'];
  familyContactFields.forEach(key => {
    if (fieldValues[key] && !state.studentListColumns.includes(key)) {
      state.studentListColumns.push(key);
    }
  });

  // 清理不存在的列（学生数据中已没有该字段）
  state.studentListColumns = state.studentListColumns.filter(col => newFields.find(f => f.key === col));

  await saveStudentFieldConfig();
}

// ========== 导航配置 ==========
const NAV_ITEMS = [
  { id: 'dashboard', name: '工作台首页', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/></svg>' },
  { id: 'students', name: '学生管理', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="2"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' },
  { id: 'grades', name: '学业成绩', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M22 10v6M2 10l10-5 10 5-10 5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 12v5c3 3 9 3 12 0v-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  { id: 'assessment', name: '综测管理', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M9 11l3 3L22 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  { id: 'career', name: '生涯规划', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  { id: 'competitions', name: '竞赛指导', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 9H4.5a2.5 2.5 0 010-5H6M18 9h1.5a2.5 2.5 0 000-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0012 0V2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  { id: 'calendar', name: '校历课表', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" stroke-width="2"/></svg>' },
  { id: 'news', name: '资讯推送', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 22h16a2 2 0 002-2V4l-10 5L2 4v16a2 2 0 002 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>' },
  { id: 'settings', name: '系统设置', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' }
];

const MODULE_TITLES = {
  dashboard: '工作台首页',
  students: '学生综合数据管理',
  grades: '学业成绩及排名',
  assessment: '综合素质测评管理',
  career: '生涯规划大数据',
  competitions: '辅导员竞赛指导',
  calendar: '校历课表与提醒',
  news: '资讯推送',
  settings: '系统设置'
};

// ========== 初始化 ==========
async function init() {
  await initDB();
  await loadStudentFieldConfig();
  initSupabase();

  if (isSupabaseReady()) {
    // Supabase 模式：检查已保存的登录会话
    let user = null;
    try {
      user = await getCurrentUser();
    } catch (e) {
      console.warn('读取本地登录会话失败:', e);
    }
    if (user) {
      // 已登录，自动进入并同步（云端不可达时降级为离线使用，不阻塞进入）
      try {
        await smartSync();
      } catch (e) {
        console.warn('云端同步失败，本次以本地数据运行:', e);
        showToast('云端暂时无法连接，本次以本设备数据离线运行', 'info');
      }
      showApp();
    } else {
      // 未登录，显示登录界面
      document.getElementById('loginScreen').style.display = 'flex';
      document.getElementById('setupScreen').style.display = 'none';
    }
  } else {
    // 纯本地模式（Supabase 未配置）
    const password = await getSetting('password');
    if (!password) {
      document.getElementById('setupScreen').style.display = 'flex';
      document.getElementById('loginScreen').style.display = 'none';
    } else {
      document.getElementById('loginScreen').style.display = 'flex';
      document.getElementById('setupScreen').style.display = 'none';
    }
  }
  bindAuthEvents();
  showTopbarDate();
}

function bindAuthEvents() {
  // 登录
  document.getElementById('loginBtn').addEventListener('click', handleLogin);
  document.getElementById('loginPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
  // 注册
  const signUpBtn = document.getElementById('signUpBtn');
  if (signUpBtn) signUpBtn.addEventListener('click', handleSignUp);
  // 离线模式（云端故障时的应急入口，数据仅保存在本设备浏览器）
  const offlineBtn = document.getElementById('offlineBtn');
  if (offlineBtn) offlineBtn.addEventListener('click', handleOfflineMode);
  // 首次设置密码（本地模式）
  document.getElementById('setupBtn').addEventListener('click', handleSetup);
  // 退出
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
}

async function handleLogin() {
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');

  if (isSupabaseReady()) {
    const email = (document.getElementById('loginEmail') || {}).value?.trim() || '';
    if (!email) { errorEl.textContent = '请输入邮箱'; return; }
    if (!password) { errorEl.textContent = '请输入密码'; return; }

    const btn = document.getElementById('loginBtn');
    btn.textContent = '登录中...';
    btn.disabled = true;
    errorEl.textContent = '';

    try {
      await supabaseSignIn(email, password);
      let syncResult = 'error';
      try {
        syncResult = await smartSync();
      } catch (syncErr) {
        console.warn('登录后同步失败，使用本地数据:', syncErr);
      }
      showApp();
      if (syncResult === 'pulled') {
        showToast('登录成功，已从云端恢复数据', 'success');
      } else if (syncResult === 'pushed') {
        showToast('登录成功，本地数据已上传云端', 'success');
      } else if (syncResult === 'synced') {
        showToast('登录成功，数据已同步', 'success');
      } else {
        showToast('登录成功', 'success');
      }
    } catch (e) {
      const msg = String(e.message || '');
      if (/load failed|fetch failed|failed to fetch|network|networkerror|timeout|aborted/i.test(msg)) {
        errorEl.textContent = '云端服务暂时无法连接：免费版 Supabase 项目可能因一段时间未使用被暂停。可先点击下方「离线模式进入」使用本设备数据，稍后登录 supabase.com 在项目页点击 Restore project 恢复。';
      } else {
        errorEl.textContent = msg || '登录失败，请检查邮箱和密码';
      }
    } finally {
      btn.textContent = '登 录';
      btn.disabled = false;
    }
  } else {
    // 纯本地模式
    if (!password) { errorEl.textContent = '请输入密码'; return; }
    const storedHash = await getSetting('password');
    if (simpleHash(password) === storedHash) {
      showApp();
    } else {
      errorEl.textContent = '密码错误，请重新输入';
      document.getElementById('loginPassword').value = '';
    }
  }
}

// 注册新账号（Supabase 模式）
async function handleSignUp() {
  const emailEl = document.getElementById('loginEmail');
  const email = emailEl ? emailEl.value.trim() : '';
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');

  if (!email) { errorEl.textContent = '请输入邮箱'; return; }
  if (password.length < 6) { errorEl.textContent = '密码至少6位'; return; }

  const btn = document.getElementById('signUpBtn');
  btn.textContent = '注册中...';
  btn.disabled = true;
  errorEl.textContent = '';

  try {
    await supabaseSignUp(email, password);
    showApp();
    showToast('注册成功，欢迎使用工作台', 'success');
  } catch (e) {
    const msg = String(e.message || '');
    if (/load failed|fetch failed|failed to fetch|network|networkerror|timeout|aborted/i.test(msg)) {
      errorEl.textContent = '云端服务暂时无法连接（项目可能被暂停），请稍后再试或使用「离线模式进入」';
    } else {
      errorEl.textContent = msg || '注册失败';
    }
  } finally {
    btn.textContent = '注册新账号';
    btn.disabled = false;
  }
}

// 离线模式：云端故障时的应急入口
// 数据只保存在当前设备的浏览器（IndexedDB）中，不联网，符合隐私保护要求
async function handleOfflineMode() {
  const storedHash = await getSetting('password');
  if (!storedHash) {
    const pw = prompt('首次使用离线模式，请设置一个本地访问密码（至少6位，仅用于本设备打开时验证）：');
    if (pw == null) return;
    if (pw.trim().length < 6) { alert('密码至少6位，请重试'); return; }
    await setSetting('password', simpleHash(pw.trim()));
  } else {
    const pw = prompt('请输入本地访问密码：');
    if (pw == null) return;
    if (simpleHash(pw) !== storedHash) { alert('密码错误'); return; }
  }
  // 关闭云同步，进入纯本地模式
  syncState.enabled = false;
  syncState.userEmail = null;
  showToast('已进入离线模式：数据仅保存在本设备浏览器。云端恢复后刷新页面即可重新邮箱登录同步', 'info');
  showApp();
}

async function handleSetup() {
  const pw = document.getElementById('setupPassword').value;
  const pw2 = document.getElementById('setupPasswordConfirm').value;
  const errorEl = document.getElementById('setupError');
  if (pw.length < 6) { errorEl.textContent = '密码至少6位'; return; }
  if (pw !== pw2) { errorEl.textContent = '两次密码不一致'; return; }
  await setSetting('password', simpleHash(pw));
  showToast('密码设置成功，欢迎进入工作台', 'success');
  showApp();
}

async function handleLogout() {
  if (!confirm('确定要退出登录吗？')) return;
  if (isSupabaseReady()) {
    try { await supabaseSignOut(); } catch (e) { console.warn('退出失败:', e); }
  }
  document.getElementById('mainApp').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  const emailEl = document.getElementById('loginEmail');
  if (emailEl) emailEl.value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').textContent = '';
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('mainApp').style.display = 'flex';
  // 更新侧边栏用户显示
  if (syncState.userEmail) {
    const nameEl = document.getElementById('sidebarUserName');
    if (nameEl) nameEl.textContent = syncState.userEmail.split('@')[0];
  }
  updateSyncIndicator();
  initNavigation();
  navigateTo('dashboard');
}

function showTopbarDate() {
  const now = new Date();
  const days = ['日','一','二','三','四','五','六'];
  const dateStr = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 星期${days[now.getDay()]}`;
  const el = document.getElementById('topbarDate');
  if (el) el.textContent = dateStr;
  setTimeout(showTopbarDate, 60000);
}

// ========== 导航 ==========
function initNavigation() {
  const nav = document.getElementById('sidebarNav');
  nav.innerHTML = NAV_ITEMS.map(item =>
    `<div class="nav-item" data-module="${item.id}">${item.icon}<span>${item.name}</span></div>`
  ).join('');

  nav.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => {
      navigateTo(el.dataset.module);
      if (window.innerWidth <= 768) closeSidebar();
    });
  });

  document.getElementById('mobileMenuBtn').addEventListener('click', toggleSidebar);
  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').style.display =
    document.getElementById('sidebar').classList.contains('open') ? 'block' : 'none';
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').style.display = 'none';
}

function navigateTo(module) {
  state.currentModule = module;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.module === module);
  });
  document.getElementById('topbarTitle').textContent = MODULE_TITLES[module] || '';
  const content = document.getElementById('mainContent');
  content.innerHTML = '';
  const renderer = MODULE_RENDERERS[module];
  if (renderer) renderer(content);
}

// ========== 工具函数 ==========
function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function showModal(title, bodyHTML, footerHTML = '') {
  const container = document.getElementById('modalContainer');
  container.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">${title}</span>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">${bodyHTML}</div>
      ${footerHTML ? `<div class="modal-footer">${footerHTML}</div>` : ''}
    </div>`;
  container.classList.add('show');
  container.addEventListener('click', (e) => {
    if (e.target === container) closeModal();
  });
}

function closeModal() {
  const container = document.getElementById('modalContainer');
  container.classList.remove('show');
  container.innerHTML = '';
  if (typeof _pendingPromptResolve !== 'undefined' && _pendingPromptResolve) {
    const resolve = _pendingPromptResolve;
    _pendingPromptResolve = null;
    resolve(null);
  }
}

// 自定义输入弹窗（替代被浏览器拦截的 prompt）
let _pendingPromptResolve = null;
function showPromptModal(title, label, placeholder, defaultValue) {
  return new Promise((resolve) => {
    _pendingPromptResolve = resolve;
    showModal(title, `
      <div class="input-group" style="margin-bottom:16px">
        <label class="input-label">${label}</label>
        <input type="text" class="input" id="f_promptInput" value="${defaultValue || ''}" placeholder="${placeholder || ''}" style="width:100%" onkeydown="if(event.key==='Enter'){confirmPromptModal()}">
      </div>
    `, `<button class="btn btn-outline" onclick="cancelPromptModal()">取消</button><button class="btn btn-primary" onclick="confirmPromptModal()">确定</button>`);
    setTimeout(() => { const el = document.getElementById('f_promptInput'); if (el) { el.focus(); el.select(); } }, 100);
  });
}
function confirmPromptModal() {
  const val = document.getElementById('f_promptInput')?.value.trim() || '';
  if (_pendingPromptResolve) { const r = _pendingPromptResolve; _pendingPromptResolve = null; r(val); }
  closeModal();
}
function cancelPromptModal() {
  if (_pendingPromptResolve) { const r = _pendingPromptResolve; _pendingPromptResolve = null; r(null); }
  closeModal();
}

function desensitizeName(name) {
  if (!name || name.length <= 1) return name;
  if (name.length === 2) return name[0] + '*';
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
}

function desensitizePhone(phone) {
  if (!phone || phone.length < 7) return phone;
  return phone.substring(0, 3) + '****' + phone.substring(phone.length - 4);
}

function desensitizeAddr(addr) {
  if (!addr) return addr;
  if (addr.length <= 6) return addr.substring(0, 2) + '**';
  return addr.substring(0, 4) + '****' + addr.substring(addr.length - 2);
}

function exportToExcel(data, filename, sheetName = 'Sheet1') {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function showLoading(text = '加载中...') {
  const div = document.createElement('div');
  div.id = 'loadingOverlay';
  div.className = 'loading-overlay';
  div.innerHTML = `<div style="text-align:center"><div class="loading-spinner"></div><div class="loading-text">${text}</div></div>`;
  document.body.appendChild(div);
}

function hideLoading() {
  const el = document.getElementById('loadingOverlay');
  if (el) el.remove();
}

// ========== 模块渲染器 ==========
const MODULE_RENDERERS = {};

// ---------- 首页 ----------
MODULE_RENDERERS.dashboard = async function(container) {
  // 获取校历课表数据
  const scheduleImage = await getSetting('calendarImage');
  const schedule = await getSetting('schedule', []);

  const today = new Date();
  const currentDayIndex = (today.getDay() + 6) % 7;
  const days = ['周一','周二','周三','周四','周五','周六','周日'];
  const timeSlots = [
    { period: '第1-2节', time: '08:00-09:35' }, { period: '第3-4节', time: '09:50-11:25' },
    { period: '第5-6节', time: '11:40-13:15' }, { period: '第7-8节', time: '14:00-15:35' },
    { period: '第9-10节', time: '15:50-17:25' }, { period: '第11-12节', time: '19:00-20:35' }
  ];

  // 智能计算教学周
  const wi = await getWeekInfo();

  // 下一个法定假日
  const holidays = [
    { name: '国庆节', date: '10-01' },
    { name: '元旦', date: '01-01' },
    { name: '春节', date: '01-29' },
    { name: '清明节', date: '04-05' },
    { name: '劳动节', date: '05-01' },
    { name: '端午节', date: '06-19' },
    { name: '中秋节', date: '09-25' }
  ];
  let nextHoliday = null;
  let minDiff = Infinity;
  holidays.forEach(h => {
    const [m, d] = h.date.split('-').map(Number);
    let hDate = new Date(today.getFullYear(), m - 1, d);
    if (hDate < today) hDate.setFullYear(today.getFullYear() + 1);
    const diff = Math.ceil((hDate - today) / (1000 * 60 * 60 * 24));
    if (diff < minDiff) { minDiff = diff; nextHoliday = { ...h, daysLeft: diff }; }
  });

  // 整理本周课程（按天分组，按单双周过滤）
  const weekClasses = [];
  for (let di = 0; di < 7; di++) {
    const dayClasses = schedule.filter(s => s.day === di && isCourseThisWeek(s, wi)).sort((a, b) => a.slot - b.slot);
    if (dayClasses.length > 0) {
      weekClasses.push({
        dayIndex: di,
        dayName: days[di],
        isToday: di === currentDayIndex,
        classes: dayClasses.map(c => ({
          ...c,
          time: timeSlots[c.slot] ? timeSlots[c.slot].time : ''
        }))
      });
    }
  }
  const todayClasses = weekClasses.find(w => w.isToday);

  // 重点资讯：每个分类取第一条
  const categories = ['思政教育','学生管理','党建工作','就业指导','政策新规','能力提升'];
  const keyNews = categories.map(cat => {
    const source = NEWS_SOURCES.find(s => s.category === cat);
    return source ? { ...source, category: cat } : null;
  }).filter(Boolean);

  container.innerHTML = `
    <div class="reminder-banner" id="reminderBanner" style="display:none">
      <span class="reminder-icon">⏰</span>
      <span id="reminderText"></span>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-bottom:16px">
      <!-- 校历卡片 -->
      <div class="card" style="margin-bottom:0">
        <div class="card-header">
          <div>
            <div class="card-title">📅 校历与教学周</div>
            <div class="card-subtitle">${wi ? wi.label : '尚未设置学期开始日期'}</div>
          </div>
          <button class="btn btn-outline btn-sm" onclick="navigateTo('calendar')">管理</button>
        </div>
        <div style="display:flex;gap:12px;align-items:flex-start">
          ${scheduleImage
            ? `<div style="width:80px;height:80px;border-radius:8px;overflow:hidden;flex-shrink:0;background:var(--bg-light)"><img src="${scheduleImage}" style="width:100%;height:100%;object-fit:cover" alt="校历"></div>`
            : `<div style="width:80px;height:80px;border-radius:8px;flex-shrink:0;background:var(--bg-light);display:flex;align-items:center;justify-content:center;font-size:28px">📅</div>`
          }
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;color:var(--text-title);font-weight:600;margin-bottom:6px">
              ${nextHoliday ? `距${nextHoliday.name}还有 <span style="color:var(--primary);font-size:18px">${nextHoliday.daysLeft}</span> 天` : '假期信息加载中'}
            </div>
            <div style="font-size:13px;color:var(--text-muted);line-height:1.6">
              ${scheduleImage ? '校历已导入，点击管理查看完整校历' : '未导入校历图片，请至「校历课表」模块上传'}
            </div>
          </div>
        </div>
      </div>

      <!-- 本周课程卡片 -->
      <div class="card" style="margin-bottom:0">
        <div class="card-header">
          <div>
            <div class="card-title">📚 本周课程情况</div>
            <div class="card-subtitle">${wi ? `本周${wi.weekType}，已智能过滤课程 · ` : ''}${todayClasses ? `今天（${days[currentDayIndex]}）有 ${todayClasses.classes.length} 节课` : `今天（${days[currentDayIndex]}）无课`}</div>
          </div>
          <button class="btn btn-outline btn-sm" onclick="navigateTo('calendar')">课表</button>
        </div>
        ${weekClasses.length > 0
          ? `<div style="max-height:200px;overflow-y:auto;padding-right:4px">
              ${weekClasses.map(w => `
                <div style="margin-bottom:10px;padding:10px;border-radius:6px;background:${w.isToday ? 'var(--bg-blue)' : 'var(--bg-light)'};border-left:3px solid ${w.isToday ? 'var(--primary)' : 'transparent'}">
                  <div style="font-size:13px;font-weight:600;color:var(--text-title);margin-bottom:4px">${w.dayName}${w.isToday ? ' <span style="color:var(--primary);font-size:12px">（今天）</span>' : ''}</div>
                  <div style="display:flex;flex-wrap:wrap;gap:6px">
                    ${w.classes.map(c => `<span style="font-size:12px;color:var(--text-body);background:#fff;padding:3px 8px;border-radius:4px;border:1px solid var(--border-color)">${c.time} ${c.course}${c.location ? ' @' + c.location : ''}${c.weekType && c.weekType !== 'all' ? ` <span class="week-badge ${c.weekType}" style="font-size:8px">${c.weekType === 'odd' ? '单' : '双'}</span>` : ''}</span>`).join('')}
                  </div>
                </div>
              `).join('')}
             </div>`
          : `<div class="empty-state" style="padding:20px"><div class="empty-icon" style="font-size:32px">📚</div><div class="empty-text" style="font-size:13px">尚未录入课表，点击「课表」按钮添加</div></div>`
        }
      </div>
    </div>

    <!-- 重点资讯卡片 -->
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">📰 重点资讯</div>
          <div class="card-subtitle">教育部、省教育厅、学习强国等官方渠道精选</div>
        </div>
        <button class="btn btn-outline btn-sm" onclick="navigateTo('news')">查看更多</button>
      </div>
      <div>
        ${keyNews.map(s => `
          <div class="news-item">
            <span class="news-tag tag-blue">${s.category}</span>
            <div class="news-content">
              <a href="${s.url}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">
                <div class="news-title">${s.title}</div>
              </a>
              <div class="news-meta">${s.source} · 点击跳转官网查看最新通知</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">快捷操作</div>
          <div class="card-subtitle">常用功能入口</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">
        <button class="btn btn-outline" onclick="navigateTo('students')">📥 导入学生数据</button>
        <button class="btn btn-outline" onclick="navigateTo('grades')">📊 导入成绩</button>
        <button class="btn btn-outline" onclick="navigateTo('assessment')">📋 导入综测</button>
        <button class="btn btn-outline" onclick="navigateTo('competitions')">🏆 竞赛指导</button>
        <button class="btn btn-outline" onclick="navigateTo('calendar')">📅 校历课表</button>
        <button class="btn btn-outline" onclick="navigateTo('news')">📰 资讯推送</button>
      </div>
    </div>
  `;

  // 打卡提醒
  checkClockReminder();
};

function checkClockReminder() {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const day = now.getDay();

  if (day >= 1 && day <= 5 && hour === 8 && minute >= 35 && minute < 50) {
    const banner = document.getElementById('reminderBanner');
    const text = document.getElementById('reminderText');
    if (banner && text) {
      banner.style.display = 'flex';
      text.textContent = '提醒：请前往打卡机完成考勤打卡（8:40）';
    }
  }
  setTimeout(checkClockReminder, 30000);
}

// ---------- 学生管理 ----------
MODULE_RENDERERS.students = async function(container) {
  state.students = await dbGetAll('students');
  // 自动同步字段配置（兼容旧数据）
  await syncStudentFields(state.students);
  renderStudentList(container);
};

function renderStudentList(container) {
  const students = state.students;
  const columns = state.studentListColumns.filter(c => !SYSTEM_FIELDS.includes(c));

  // 顶部固定筛选器：搜索 + 学历层次 + 年级 + 专业 + 班级 + 性别 + 民族 + 政治面貌
  const topFilterFields = ['gradeLevel', 'year', 'major', 'className', 'gender', 'ethnicity', 'politicalStatus'];
  const topFiltersHtml = topFilterFields.map(key => {
    const field = state.studentFields.find(f => f.key === key);
    if (!field) return '';
    const values = [...new Set(students.map(s => s[key]).filter(Boolean))].sort();
    if (values.length === 0) return '';
    return `
      <select class="select student-filter" data-field="${key}" onchange="applyStudentFilter()">
        <option value="">全部${field.name}</option>
        ${values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')}
      </select>
    `;
  }).join('');

  container.innerHTML = `
    ${renderStudentStats(students)}
    <div class="card">
      <div class="card-header" style="justify-content:flex-start;align-items:flex-start;gap:24px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0">
          <button class="btn btn-primary" onclick="triggerStudentImport()">📥 导入Excel</button>
          <button class="btn btn-outline" onclick="showAddStudentForm()">➕ 手动添加</button>
          <button class="btn btn-outline" onclick="showFieldManager()">⚙️ 调整字段</button>
          <button class="btn btn-outline" onclick="exportStudentsList()">📤 导出全部</button>
          <button class="btn btn-outline" onclick="exportSelectedStudents()" id="exportSelectedBtn" style="display:none">📤 导出选中</button>
          <button class="btn btn-outline" onclick="fixStudentData()" title="合并重复学号/姓名的数据">🔧 修复重复</button>
        </div>
        <div>
          <div class="card-title">学生数据管理</div>
          <div class="card-subtitle">共 ${students.length} 名学生 · 已识别 ${state.studentFields.length} 个信息分类 · 支持Excel批量导入</div>
        </div>
      </div>

      <div class="filter-bar" id="studentFilterBar">
        <input type="text" class="input" id="searchInput" placeholder="搜索姓名/学号" style="min-width:160px" oninput="applyStudentFilter()">
        ${topFiltersHtml}
      </div>
      <div id="filterResultBar" class="filter-result-bar">共 ${students.length} 名学生</div>

      <div id="studentPaginationTop" class="pagination pagination-left pagination-top"></div>

      <div class="table-wrapper">
        <table class="data-table" id="studentTable">
          <thead>
            <tr>
              <th style="width:36px"><input type="checkbox" id="selectAllCheckbox" onchange="toggleSelectAll(this)"></th>
              <th style="width:48px">序号</th>
              ${columns.map(c => `<th>${getFieldDisplayName(c)}</th>`).join('')}
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="studentTableBody"></tbody>
        </table>
      </div>
      <div id="studentPaginationBottom" class="pagination pagination-left"></div>
    </div>
  `;

  applyStudentFilter();
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applyStudentFilter() {
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase();

  // 收集顶部固定筛选条件
  const filterConditions = {};
  document.querySelectorAll('.student-filter').forEach(sel => {
    const field = sel.dataset.field;
    const value = sel.value;
    if (value) filterConditions[field] = value;
  });

  state.filteredStudents = state.students.filter(s => {
    if (search && !(s.name?.toLowerCase().includes(search) || s.studentId?.includes(search))) return false;
    for (const [field, value] of Object.entries(filterConditions)) {
      if (String(s[field] || '') !== value) return false;
    }
    return true;
  });

  state.currentPage = 1;
  renderStudentTable(state.filteredStudents);

  // 更新筛选结果计数
  const bar = document.getElementById('filterResultBar');
  if (bar) {
    bar.textContent = `当前筛选条件下共 ${state.filteredStudents.length} 名学生`;
  }
}

function renderStudentTable(students) {
  const tbody = document.getElementById('studentTableBody');
  if (!tbody) return;

  const columns = state.studentListColumns.filter(c => !SYSTEM_FIELDS.includes(c));
  const start = (state.currentPage - 1) * state.pageSize;
  const pageData = students.slice(start, start + state.pageSize);
  const totalPages = Math.ceil(students.length / state.pageSize);

  if (students.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${columns.length + 3}"><div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-text">暂无学生数据，请点击「导入Excel」或「手动添加」</div>
    </div></td></tr>`;
  } else {
    tbody.innerHTML = pageData.map((s, idx) => {
      const seq = start + idx + 1;
      const checked = state.selectedStudentIds.has(s.id) ? 'checked' : '';
      return `
      <tr class="row-clickable">
        <td onclick="event.stopPropagation()"><input type="checkbox" class="row-checkbox" data-id="${s.id}" onchange="toggleSelectStudent(${s.id}, this)" ${checked}></td>
        <td class="row-seq">${seq}</td>
        ${columns.map(c => `<td onclick="showStudentDetail(${s.id})">${renderCellValue(c, s[c])}</td>`).join('')}
        <td onclick="event.stopPropagation()">
          <button class="btn btn-sm btn-outline" onclick="showEditStudentForm(${s.id})">编辑</button>
          <button class="btn btn-sm btn-danger" onclick="deleteStudentConfirm(${s.id})">删除</button>
        </td>
      </tr>`;
    }).join('');
  }

  // 更新全选复选框状态
  const selectAllCb = document.getElementById('selectAllCheckbox');
  if (selectAllCb) {
    const pageIds = pageData.map(s => s.id);
    const allChecked = pageIds.length > 0 && pageIds.every(id => state.selectedStudentIds.has(id));
    selectAllCb.checked = allChecked;
  }

  // 更新导出选中按钮显示
  updateExportSelectedBtn();

  // 分页（带跳页功能）— 同时渲染上方和下方两个分页区域，均左对齐
  const pagTop = document.getElementById('studentPaginationTop');
  const pagBottom = document.getElementById('studentPaginationBottom');
  let pagHtml = '';
  if (totalPages > 1) {
    pagHtml += `<button onclick="changeStudentPage(${state.currentPage - 1})" ${state.currentPage <= 1 ? 'disabled' : ''}>上一页</button>`;

    // 智能页码显示：最多显示7个页码按钮
    const maxButtons = 7;
    let startPage = 1, endPage = totalPages;
    if (totalPages > maxButtons) {
      const half = Math.floor(maxButtons / 2);
      startPage = Math.max(1, state.currentPage - half);
      endPage = Math.min(totalPages, startPage + maxButtons - 1);
      if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
      }
    }

    if (startPage > 1) {
      pagHtml += `<button class="${1 === state.currentPage ? 'active' : ''}" onclick="changeStudentPage(1)">1</button>`;
      if (startPage > 2) pagHtml += `<span style="padding:0 4px;color:var(--text-muted)">…</span>`;
    }

    for (let i = startPage; i <= endPage; i++) {
      pagHtml += `<button class="${i === state.currentPage ? 'active' : ''}" onclick="changeStudentPage(${i})">${i}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) pagHtml += `<span style="padding:0 4px;color:var(--text-muted)">…</span>`;
      pagHtml += `<button class="${totalPages === state.currentPage ? 'active' : ''}" onclick="changeStudentPage(${totalPages})">${totalPages}</button>`;
    }

    pagHtml += `<button onclick="changeStudentPage(${state.currentPage + 1})" ${state.currentPage >= totalPages ? 'disabled' : ''}>下一页</button>`;
    // 跳页输入框
    pagHtml += `<span style="margin-left:8px;display:inline-flex;align-items:center;gap:4px;font-size:13px;color:var(--text-muted)">第<input type="number" min="1" max="${totalPages}" value="${state.currentPage}" style="width:50px;padding:2px 4px;border:1px solid var(--border);border-radius:4px;text-align:center" onchange="jumpToPage(this.value, ${totalPages})">页/共${totalPages}页</span>`;
  }
  if (pagTop) pagTop.innerHTML = pagHtml;
  if (pagBottom) pagBottom.innerHTML = pagHtml;
}

function jumpToPage(value, totalPages) {
  const page = parseInt(value);
  if (isNaN(page) || page < 1 || page > totalPages) return;
  changeStudentPage(page);
}

function renderCellValue(fieldKey, value) {
  if (value == null || value === '') {
    const defaults = { ethnicity: '汉族', gradeLevel: '本科', careerGoal: '暂未规划' };
    if (defaults[fieldKey] && state.studentFields.find(f => f.key === fieldKey)) return `<span class="text-muted">${defaults[fieldKey]}</span>`;
    return '-';
  }
  if (fieldKey === 'careerGoal') return `<span class="tag tag-blue">${value}</span>`;
  return escapeHtml(value);
}

// ========== 学生统计面板 ==========
function renderStudentStats(students) {
  const stats = computeStudentStats(students);
  return `
    <div class="stat-grid">
      ${renderStatCard('本科生', stats.undergraduate, 'stat-blue', '🎓')}
      ${renderStatCard('硕士研究生', stats.master, 'stat-green', '📚')}
      ${renderStatCard('博士研究生', stats.doctor, 'stat-orange', '🔬')}
    </div>
  `;
}

function renderStatCard(label, stat, color, icon) {
  if (!stat) return '';
  const ethnicEntries = Object.entries(stat.ethnicities).sort((a, b) => b[1] - a[1]);
  const ethnicChips = ethnicEntries.length
    ? ethnicEntries.map(([k, v]) => `<span class="eth-chip">${escapeHtml(k)} ${v}</span>`).join('')
    : '<span class="eth-chip">未填写</span>';
  const classEntries = Object.entries(stat.classes).sort((a, b) => b[1] - a[1]);
  const classChips = classEntries.length
    ? classEntries.map(([k, v]) => `<span class="eth-chip class-chip">${escapeHtml(k)} ${v}</span>`).join('')
    : '<span class="eth-chip">未分班</span>';
  return `
    <div class="stat-card ${color}">
      <div class="stat-main">
        <div class="stat-icon">${icon}</div>
        <div>
          <div class="stat-value">${stat.total}</div>
          <div class="stat-label">在校${label}总数</div>
        </div>
      </div>
      <div class="stat-detail">
        <span>男 ${stat.male}</span><span>女 ${stat.female}</span>
        <span>党员 ${stat.party}</span><span>团员 ${stat.league}</span><span>群众 ${stat.mass}</span>
      </div>
      <div class="stat-ethnic">
        <div class="stat-ethnic-title">各民族人数</div>
        <div class="stat-ethnic-chips">${ethnicChips}</div>
      </div>
      <div class="stat-ethnic">
        <div class="stat-ethnic-title">各班级人数</div>
        <div class="stat-ethnic-chips">${classChips}</div>
      </div>
    </div>
  `;
}

function computeStudentStats(students) {
  const classifyLevel = (val) => {
    const v = String(val || '').toLowerCase();
    if (v.includes('博士')) return 'doctor';
    if (v.includes('硕士')) return 'master';
    if (v.includes('本科')) return 'undergraduate';
    return null;
  };

  const classifyPolitical = (val) => {
    const v = String(val || '');
    if (v.includes('党员')) return 'party';
    if (v.includes('团')) return 'league';
    if (v === '群众') return 'mass';
    return 'other';
  };

  const result = {
    undergraduate: { total: 0, male: 0, female: 0, party: 0, league: 0, mass: 0, ethnicities: {}, classes: {} },
    master: { total: 0, male: 0, female: 0, party: 0, league: 0, mass: 0, ethnicities: {}, classes: {} },
    doctor: { total: 0, male: 0, female: 0, party: 0, league: 0, mass: 0, ethnicities: {}, classes: {} }
  };

  students.forEach(s => {
    const level = classifyLevel(s.gradeLevel);
    if (!level) return;
    const stat = result[level];
    stat.total++;

    const gender = String(s.gender || '');
    if (gender === '男') stat.male++;
    else if (gender === '女') stat.female++;

    const pol = classifyPolitical(s.politicalStatus);
    if (pol === 'party') stat.party++;
    else if (pol === 'league') stat.league++;
    else if (pol === 'mass') stat.mass++;

    const ethnic = String(s.ethnicity || '未填写');
    stat.ethnicities[ethnic] = (stat.ethnicities[ethnic] || 0) + 1;

    const className = String(s.className || '未分班').trim();
    stat.classes[className] = (stat.classes[className] || 0) + 1;
  });

  return result;
}

function changeStudentPage(page) {
  state.currentPage = page;
  // 直接渲染表格，不重新筛选（避免重置页码）
  renderStudentTable(state.filteredStudents);
}

// Excel 导入
function triggerStudentImport() {
  state.fileImportCallback = handleStudentExcelImport;
  document.getElementById('fileInput').click();
}

document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  // 无论是否选择文件，都恢复默认 accept
  e.target.accept = '.xlsx,.xls,.csv';
  if (!file) return;
  if (state.fileImportCallback) {
    await state.fileImportCallback(file);
    state.fileImportCallback = null;
  }
  e.target.value = '';
});

// 修复/合并重复数据：按学号合并，学号缺失时按姓名合并
async function fixStudentData() {
  if (!confirm('将按「学号 → 姓名」合并重复的学生记录，重复项会被删除、字段会合并。确定继续？')) return;
  showLoading('正在修复重复数据...');
  try {
    const all = await dbGetAll('students');
    const before = all.length;
    if (before === 0) { hideLoading(); showToast('暂无学生数据', 'error'); return; }

    // 1) 按学号分组
    const byId = new Map();
    const noId = [];
    all.forEach(s => {
      const sid = normalizeStudentId(s.studentId);
      if (sid) { if (!byId.has(sid)) byId.set(sid, []); byId.get(sid).push(s); }
      else noId.push(s);
    });

    const keepers = [];
    const nameIndex = new Map();
    const mergeInto = (keeper, dup) => {
      Object.keys(dup).forEach(k => {
        if (SYSTEM_FIELDS.includes(k) || k === 'studentId') return;
        const v = dup[k];
        if (v !== '' && v != null && !keeper[k]) keeper[k] = v;
      });
    };

    // 2) 合并同学号的多条记录
    for (const [, list] of byId) {
      list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      const keeper = list[0];
      for (let i = 1; i < list.length; i++) mergeInto(keeper, list[i]);
      keepers.push(keeper);
      const nm = String(keeper.name || '').trim();
      if (nm && !nameIndex.has(nm)) nameIndex.set(nm, keeper);
    }

    // 3) 无学号记录：按姓名并入已有 keeper，否则独立保留
    for (const s of noId) {
      const nm = String(s.name || '').trim();
      if (nm && nameIndex.has(nm)) {
        mergeInto(nameIndex.get(nm), s);
      } else {
        keepers.push(s);
        if (nm && !nameIndex.has(nm)) nameIndex.set(nm, s);
      }
    }

    // 4) 写回：删除被合并掉的记录
    const keeperIds = new Set(keepers.map(k => k.id));
    const toDelete = all.filter(s => !keeperIds.has(s.id));
    for (const d of toDelete) await dbDelete('students', d.id);
    for (const k of keepers) { k.updatedAt = k.updatedAt || Date.now(); await dbPut('students', k); }

    const after = keepers.length;
    state.students = keepers;
    await syncStudentFields(keepers);
    hideLoading();
    showToast(`数据修复完成：合并前 ${before} 条 → 合并后 ${after} 条，已移除 ${before - after} 条重复`, 'success');
    navigateTo('students');
  } catch (e) {
    hideLoading();
    console.error(e);
    showToast('修复失败：' + e.message, 'error');
  }
}

async function handleStudentExcelImport(file) {
  showLoading('正在解析Excel文件...');
  try {
    const data = await readExcelFile(file);
    if (!data || data.length === 0) {
      hideLoading();
      showToast('文件为空或格式不正确', 'error');
      return;
    }

    // 动态字段映射：识别Excel中所有列
    const mapped = data.map(row => mapStudentRowDynamic(row));
    const valid = mapped.filter(s => s.studentId || s.name);

    if (valid.length === 0) {
      hideLoading();
      showToast('未识别到有效学生数据：Excel 需至少包含「学号」或「姓名」列之一（仅有学号列也可上传）', 'error');
      return;
    }

    // 合并已有数据（按学号去重深合并）
    const existing = await dbGetAll('students');
    const existingById = {};
    existing.forEach(s => { existingById[normalizeStudentId(s.studentId)] = s; });

    // 先清理数据库中已有的重复学号（保留更新时间最晚的一条）
    const duplicates = new Map();
    existing.forEach(s => {
      const sid = normalizeStudentId(s.studentId);
      if (!sid) return;
      if (!duplicates.has(sid)) {
        duplicates.set(sid, []);
      }
      duplicates.get(sid).push(s);
    });
    for (const [sid, list] of duplicates) {
      if (list.length > 1) {
        list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        const keeper = list[0];
        // 合并重复记录中的非空字段
        for (let i = 1; i < list.length; i++) {
          const dup = list[i];
          Object.keys(dup).forEach(key => {
            if (SYSTEM_FIELDS.includes(key)) return;
            if (key === 'studentId') return;
            const val = dup[key];
            if (val !== '' && val != null && !keeper[key]) {
              keeper[key] = val;
            }
          });
        }
        keeper.updatedAt = Date.now();
        await dbPut('students', keeper);
        // 删除其余重复记录
        for (let i = 1; i < list.length; i++) {
          await dbDelete('students', list[i].id);
          delete existingById[normalizeStudentId(list[i].studentId)];
        }
        existingById[sid] = keeper;
      }
    }

    // 建立姓名索引（用于学号缺失时按姓名匹配）
    const existingByName = {};
    Object.values(existingById).forEach(s => {
      const nm = String(s.name || '').trim();
      if (nm && !existingByName[nm]) existingByName[nm] = s;
    });

    let newCount = 0, updateCount = 0;

    for (const student of valid) {
      const sid = normalizeStudentId(student.studentId);
      const nm = String(student.name || '').trim();
      // 优先按学号匹配，学号缺失时按姓名匹配
      let exist = (sid && existingById[sid]) || null;
      if (!exist && nm) exist = existingByName[nm] || null;

      if (exist) {
        // 深合并规则（与用户约定一致）：
        // ① 新表中某字段为空/缺失 → 保留原数据，绝不覆盖（mapStudentRowDynamic 已跳过空单元格，这里再兜底判断）
        // ② 新表字段有非空值 → 覆盖旧值
        // ③ 新表出现原数据没有的字段 → 追加
        const merged = { ...exist };
        Object.keys(student).forEach(key => {
          if (SYSTEM_FIELDS.includes(key)) return;
          const newVal = student[key];
          if (newVal !== '' && newVal != null) {
            merged[key] = newVal;
          }
        });
        merged.updatedAt = Date.now();
        await dbPut('students', merged);
        if (sid) existingById[sid] = merged;
        if (nm) existingByName[nm] = merged;
        updateCount++;
      } else {
        student.createdAt = Date.now();
        student.updatedAt = Date.now();
        if (sid) student.studentId = sid;
        await dbAdd('students', student);
        if (sid) existingById[sid] = student;
        if (nm) existingByName[nm] = student;
        newCount++;
      }
    }

    // 重新同步字段配置（根据所有学生数据）
    const updatedStudents = await dbGetAll('students');
    await syncStudentFields(updatedStudents);

    hideLoading();
    const finalCount = updatedStudents.length;
    showToast(`导入完成：新增 ${newCount} 人，合并更新 ${updateCount} 人，当前共 ${finalCount} 人，识别 ${state.studentFields.length} 个字段`, 'success');
    state.students = updatedStudents;
    navigateTo('students');
  } catch (err) {
    hideLoading();
    console.error(err);
    showToast('导入失败：' + err.message, 'error');
  }
}

function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        // raw: false 保留 Excel 中显示的文本格式，避免长数字学号被转成数字格式
        const data = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
        resolve(data);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function mapStudentRowDynamic(row) {
  const result = {};

  // 遍历Excel中所有列，自动映射为字段
  Object.keys(row).forEach(colName => {
    const rawValue = row[colName];
    if (rawValue === '' || rawValue == null) return;

    const fieldKey = columnToFieldKey(colName);
    let value = rawValue;

    // 数值类型处理
    if (typeof value === 'number') {
      value = String(value);
    } else {
      value = String(value).trim();
    }

    // 如果同一字段出现多次，后面的覆盖前面的
    result[fieldKey] = value;
  });

  // 学号统一标准化，确保跨表格合并时不会因为空格/格式差异产生重复
  if (result.studentId) {
    result.studentId = normalizeStudentId(result.studentId);
  }

  // 注意：不设置任何字段默认值（尤其是民族）。
  // 之前的 ethnicity 默认'汉族'会在 Excel 缺民族列时把已有正确数据全部覆盖，属于严重 bug，已移除。
  // 字段缺失时保留为空，展示为「未填写」，绝不覆盖已有数据。

  return result;
}

// 手动添加/编辑
function showAddStudentForm() {
  state.editingStudentId = null;
  showStudentForm(null);
}

async function showEditStudentForm(id) {
  const student = await dbGet('students', id);
  state.editingStudentId = id;
  showStudentForm(student);
}

function showStudentForm(data) {
  const s = data || {};
  const modalBody = generateStudentFormHTML(s);
  showModal('学生信息' + (data ? '编辑' : '添加'), modalBody,
    `<button class="btn btn-outline" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveStudentForm()">保存</button>`);
}

function generateStudentFormHTML(s) {
  // 收集学生数据中已有的字段（包括未在字段配置中的）
  const allFieldKeys = new Set([
    ...state.studentFields.map(f => f.key),
    ...Object.keys(s).filter(k => !SYSTEM_FIELDS.includes(k))
  ]);

  // 确保核心字段存在
  const coreFields = ['studentId', 'name', 'gender', 'ethnicity', 'birthDate', 'gradeLevel', 'year', 'major', 'className', 'careerGoal', 'phone', 'address'];
  coreFields.forEach(k => { if (!allFieldKeys.has(k)) allFieldKeys.add(k); });

  // 按字段配置顺序排列
  const orderedKeys = [];
  state.studentFields.forEach(f => {
    if (allFieldKeys.has(f.key)) orderedKeys.push(f.key);
  });
  allFieldKeys.forEach(k => {
    if (!orderedKeys.includes(k)) orderedKeys.push(k);
  });

  const rows = [];
  let currentRow = [];

  orderedKeys.forEach((key, index) => {
    const field = state.studentFields.find(f => f.key === key);
    const label = field?.name || getFieldDisplayName(key);
    const value = s[key] || '';
    const isRequired = key === 'studentId' || key === 'name';
    const inputHtml = generateFormInput(key, value, field, isRequired);

    currentRow.push(`<div class="input-group"><label class="input-label">${label}${isRequired ? ' *' : ''}</label>${inputHtml}</div>`);

    // 学号姓名单独一行，其他字段每行2个
    if ((key === 'name') || currentRow.length >= 2) {
      rows.push(`<div class="form-row${currentRow.length >= 3 ? ' triple' : ''}">${currentRow.join('')}</div>`);
      currentRow = [];
    }
  });

  if (currentRow.length > 0) {
    rows.push(`<div class="form-row">${currentRow.join('')}</div>`);
  }

  return rows.join('');
}

function generateFormInput(key, value, field, isRequired) {
  const safeValue = escapeHtml(value);
  const id = `f_${key}`;

  // 特殊下拉字段
  const selectOptions = {
    gender: ['', '男', '女'],
    gradeLevel: ['本科', '硕士研究生', '博士研究生'],
    careerGoal: ['暂未规划', '考研', '考公', '就业求职', '出国留学'],
    politicalStatus: ['群众', '共青团员', '中共党员', '中共预备党员', '民主党派'],
    studentStatus: ['在读', '休学', '退学', '毕业', '结业']
  };

  if (selectOptions[key]) {
    return `<select class="select" id="${id}">${selectOptions[key].map(opt => `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt || '请选择'}</option>`).join('')}</select>`;
  }

  // 日期字段
  if (field?.type === 'date' || ['birthDate', 'enrollmentDate', 'graduationDate'].includes(key)) {
    return `<input type="date" class="input" id="${id}" value="${safeValue}">`;
  }

  // 数字字段
  if (field?.type === 'number') {
    return `<input type="number" class="input" id="${id}" value="${safeValue}">`;
  }

  // 默认文本
  return `<input type="text" class="input" id="${id}" value="${safeValue}" ${isRequired ? 'required' : ''}>`;
}

async function saveStudentForm() {
  const studentId = document.getElementById('f_studentId').value.trim();
  const name = document.getElementById('f_name').value.trim();
  if (!studentId || !name) { showToast('学号和姓名为必填项', 'error'); return; }

  const data = { studentId, name, updatedAt: Date.now() };

  // 收集所有动态字段
  state.studentFields.forEach(f => {
    if (SYSTEM_FIELDS.includes(f.key)) return;
    const el = document.getElementById(`f_${f.key}`);
    if (el) data[f.key] = el.value.trim();
  });

  // 收集学生对象中已有但字段配置中可能没有的字段（编辑时保留）
  if (state.editingStudentId) {
    const existing = await dbGet('students', state.editingStudentId);
    Object.keys(existing).forEach(key => {
      if (SYSTEM_FIELDS.includes(key) || data.hasOwnProperty(key)) return;
      const el = document.getElementById(`f_${key}`);
      if (el) data[key] = el.value.trim();
    });
  }

  // 不设置默认值：未填写的字段保留为空，展示「未填写」，保证数据真实

  if (state.editingStudentId) {
    const existing = await dbGet('students', state.editingStudentId);
    const merged = { ...existing };
    Object.keys(data).forEach(key => {
      if (data[key] === '') {
        // 空字符串是否删除？保留字段但值为空
        merged[key] = '';
      } else {
        merged[key] = data[key];
      }
    });
    merged.id = state.editingStudentId;
    await dbPut('students', merged);
    showToast('学生信息已更新', 'success');
  } else {
    data.createdAt = Date.now();
    await dbAdd('students', data);
    showToast('学生信息已添加', 'success');
  }

  closeModal();
  state.students = await dbGetAll('students');
  await syncStudentFields(state.students);
  navigateTo('students');
}

function deleteStudentConfirm(id) {
  showModal('确认删除', `<p style="font-size:14px;color:var(--text-body)">确定要删除该学生吗？删除后该学生的所有成绩和综测数据也将被删除，此操作不可撤销。</p>`,
    `<button class="btn btn-outline" onclick="closeModal()">取消</button><button class="btn btn-danger" onclick="deleteStudent(${id})">确认删除</button>`);
}

async function deleteStudent(id) {
  // 删除关联成绩和综测
  const grades = await dbGetByIndex('grades', 'studentId', String(id));
  const assessments = await dbGetByIndex('assessments', 'studentId', String(id));
  for (const g of grades) await dbDelete('grades', g.id);
  for (const a of assessments) await dbDelete('assessments', a.id);
  await dbDelete('students', id);
  closeModal();
  showToast('已删除', 'success');
  state.students = await dbGetAll('students');
  navigateTo('students');
}

// 学生详情
async function showStudentDetail(id) {
  const student = await dbGet('students', id);
  if (!student) return;
  const grades = (await dbGetByIndex('grades', 'studentId', String(id))).filter(g => g && typeof g.weightedScore === 'number');
  const allAssess = await dbGetAll('assessments');
  const assessments = allAssess.filter(a => String(a.studentId) === String(id));

  // 综测每学年排名
  const yearGroups = {};
  allAssess.forEach(a => { (yearGroups[a.academicYear] = yearGroups[a.academicYear] || []).push(a); });
  const assessRankMap = {};
  Object.keys(yearGroups).forEach(y => {
    const arr = yearGroups[y].slice().sort((x, yy) => (yy.totalScore || 0) - (x.totalScore || 0));
    arr.forEach((a, i) => { assessRankMap[String(a.studentId) + '_' + y] = i + 1; });
  });
  const assessmentRanks = assessments.map(a => ({ year: a.academicYear, score: a.totalScore, rank: assessRankMap[String(id) + '_' + a.academicYear] })).sort((a, b) => b.year.localeCompare(a.year));

  // 学业排名（已存 overallRank）
  const academicRanks = grades.map(g => ({ semester: g.semester, score: g.weightedScore, rank: g.overallRank })).sort((a, b) => a.semester.localeCompare(b.semester));

  showModal(`${student.name} - 学生详情`, `
    ${renderStudentInfoGroups(student)}

    <div class="section-title">📊 学业排名（按学期）</div>
    ${academicRanks.length > 0 ? `
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>学期</th><th>加权总分</th><th>排名</th></tr></thead>
          <tbody>
            ${academicRanks.map(r => `<tr><td>${r.semester}</td><td>${r.score != null ? r.score.toFixed(2) : '-'}</td><td><span class="tag ${r.rank && r.rank <= 3 ? 'tag-red' : 'tag-blue'}">${r.rank != null ? r.rank : '-'}</span></td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    ` : '<div class="empty-state"><div class="empty-text">暂无学业成绩数据</div></div>'}

    <div class="section-title">📋 综测排名（按学年，最新置顶）</div>
    ${assessmentRanks.length > 0 ? `
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>学年</th><th>综测总分</th><th>排名</th></tr></thead>
          <tbody>
            ${assessmentRanks.map(r => `<tr><td>${r.year}</td><td>${r.score != null ? r.score.toFixed(2) : '-'}</td><td><span class="tag ${r.rank && r.rank <= 3 ? 'tag-red' : 'tag-blue'}">${r.rank != null ? r.rank : '-'}</span></td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    ` : '<div class="empty-state"><div class="empty-text">暂无综测数据</div></div>'}
  `);
}
async function toggleCoursePolicyPass(studentId, semester, courseName) {
  const grades = await dbGetByIndex('grades', 'studentId', String(studentId));
  const g = grades.find(x => x.semester === semester);
  if (!g) return;
  const course = (g.courses || []).find(c => c.name === courseName);
  if (!course) return;
  course.policyPass = !course.policyPass;
  await dbPut('grades', { ...g, courses: g.courses, updatedAt: Date.now() });
  showToast(course.policyPass ? '已标记为政策及格' : '已取消政策及格标记', 'success');
  showStudentDetail(studentId);
  // 如果在成绩管理页，刷新统计面板
  const panel = document.getElementById('gradeStatsPanel');
  if (panel) {
    const excludeNames = state.gradeExcludeCourses?.[semester] || [];
    panel.outerHTML = renderGradeStatsPanel(semester, excludeNames);
  }
}

function renderStudentInfoGroups(student) {
  // 收集学生所有字段（排除系统字段）
  const allKeys = Object.keys(student).filter(k => !SYSTEM_FIELDS.includes(k));

  // 按分组归类
  const groups = {};
  Object.keys(FIELD_GROUPS).forEach(g => groups[g] = []);

  allKeys.forEach(key => {
    let assigned = false;
    for (const [groupName, fields] of Object.entries(FIELD_GROUPS)) {
      if (fields.includes(key)) {
        groups[groupName].push(key);
        assigned = true;
        break;
      }
    }
    if (!assigned) groups['其他信息'].push(key);
  });

  let html = '';
  Object.entries(groups).forEach(([groupName, keys]) => {
    if (keys.length === 0) return;
    html += `<div class="section-title" style="margin-top:16px;margin-bottom:10px">${groupName}</div>`;
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:16px">`;
    keys.forEach(key => {
      const label = getFieldDisplayName(key);
      let value = student[key];
      if (value === '' || value == null) {
        const defaults = { ethnicity: '汉族', gradeLevel: '本科', careerGoal: '暂未规划' };
        value = defaults[key] || '-';
      }

      // 标签化展示
      if (key === 'careerGoal') value = `<span class="tag tag-blue">${value}</span>`;
      else if (key === 'politicalStatus' && value === '中共党员') value = `<span class="tag tag-red">${value}</span>`;
      else value = escapeHtml(value);

      html += `<div class="info-group"><span class="info-label">${label}</span><span class="info-value">${value}</span></div>`;
    });
    html += `</div>`;
  });

  return html;
}

function parseExcludeRules(excludeNames = []) {
  const nameSet = new Set();
  const typeSet = new Set();
  excludeNames.forEach(x => {
    const s = String(x);
    if (s.startsWith('TYPE:')) typeSet.add(s.slice(5));
    else nameSet.add(s);
  });
  return { nameSet, typeSet };
}

function isCourseExcluded(c, nameSet, typeSet) {
  if (nameSet && nameSet.has(c.name)) return true;
  if (typeSet && typeSet.has(c.courseType || '其他')) return true;
  return false;
}

function calcWeightedAvg(courses, opts = {}) {
  if (!courses || courses.length === 0) return null;
  const { nameSet, typeSet } = parseExcludeRules(opts.excludeNames);
  let totalScore = 0, totalCredit = 0;
  courses.forEach(c => {
    if (isCourseExcluded(c, nameSet, typeSet)) return;
    const score = parseFloat(c.score);
    const credit = parseFloat(c.credit) || 1;
    if (!isNaN(score)) { totalScore += score * credit; totalCredit += credit; }
  });
  return totalCredit > 0 ? totalScore / totalCredit : null;
}

// 判断课程是否挂科（尊重政策及格）
function isCourseFailed(c) {
  if (c.policyPass) return false;
  const score = parseFloat(c.score);
  if (isNaN(score)) return false;
  if (score >= 60) return false;
  return true;
}

// 导出学生列表（全部）
async function exportStudentsList() {
  const students = state.students;
  if (students.length === 0) { showToast('暂无数据可导出', 'error'); return; }

  // 收集所有字段（按字段配置顺序）
  const fieldKeys = ['studentId', 'name', ...state.studentFields.map(f => f.key).filter(k => !SYSTEM_FIELDS.includes(k))];
  const uniqueKeys = [];
  fieldKeys.forEach(k => { if (!uniqueKeys.includes(k)) uniqueKeys.push(k); });

  const data = students.map(s => {
    const row = {};
    uniqueKeys.forEach(key => {
      row[getFieldDisplayName(key)] = s[key] || '';
    });
    return row;
  });

  exportToExcel(data, `学生列表_${formatDate(new Date())}.xlsx`, '学生列表');
  showToast(`已导出全部 ${students.length} 条数据`, 'success');
}

// 导出选中的学生
async function exportSelectedStudents() {
  if (state.selectedStudentIds.size === 0) { showToast('请先勾选要导出的学生', 'error'); return; }

  const selectedStudents = state.students.filter(s => state.selectedStudentIds.has(s.id));
  if (selectedStudents.length === 0) { showToast('未找到选中的学生数据', 'error'); return; }

  // 收集所有字段（按字段配置顺序）
  const fieldKeys = ['studentId', 'name', ...state.studentFields.map(f => f.key).filter(k => !SYSTEM_FIELDS.includes(k))];
  const uniqueKeys = [];
  fieldKeys.forEach(k => { if (!uniqueKeys.includes(k)) uniqueKeys.push(k); });

  const data = selectedStudents.map(s => {
    const row = {};
    uniqueKeys.forEach(key => {
      row[getFieldDisplayName(key)] = s[key] || '';
    });
    return row;
  });

  exportToExcel(data, `选中学生_${formatDate(new Date())}.xlsx`, '选中学生');
  showToast(`已导出选中的 ${selectedStudents.length} 条数据`, 'success');
}

// 全选/取消全选（当前页）
function toggleSelectAll(checkbox) {
  const start = (state.currentPage - 1) * state.pageSize;
  const pageData = state.filteredStudents.slice(start, start + state.pageSize);
  if (checkbox.checked) {
    pageData.forEach(s => state.selectedStudentIds.add(s.id));
  } else {
    pageData.forEach(s => state.selectedStudentIds.delete(s.id));
  }
  // 重新渲染表格以更新勾选状态
  renderStudentTable(state.filteredStudents);
}

// 单个选择/取消选择
function toggleSelectStudent(id, checkbox) {
  if (checkbox.checked) {
    state.selectedStudentIds.add(id);
  } else {
    state.selectedStudentIds.delete(id);
  }
  updateExportSelectedBtn();
  // 更新全选复选框
  const selectAllCb = document.getElementById('selectAllCheckbox');
  if (selectAllCb) {
    const start = (state.currentPage - 1) * state.pageSize;
    const pageData = state.filteredStudents.slice(start, start + state.pageSize);
    const allChecked = pageData.length > 0 && pageData.every(s => state.selectedStudentIds.has(s.id));
    selectAllCb.checked = allChecked;
  }
}

// 更新导出选中按钮显示状态
function updateExportSelectedBtn() {
  const btn = document.getElementById('exportSelectedBtn');
  if (!btn) return;
  if (state.selectedStudentIds.size > 0) {
    btn.style.display = '';
    btn.textContent = `📤 导出选中(${state.selectedStudentIds.size})`;
  } else {
    btn.style.display = 'none';
  }
}

// ---------- 字段管理器 ----------
function showFieldManager() {
  const allFields = [...state.studentFields];
  const coreKeys = CORE_FIELDS;

  const bodyHTML = `
    <div style="margin-bottom:16px">
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
        勾选「显示在列表」的字段会出现在学生总览表中。核心字段（学号、姓名）不可删除，但可调整显示顺序和是否作为筛选器。
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <input type="text" class="input" id="newFieldName" placeholder="输入新字段名称（如：入党时间）" style="flex:1">
        <button class="btn btn-outline" onclick="addCustomField()">➕ 添加字段</button>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:40px">排序</th>
              <th>字段名</th>
              <th style="width:80px">列表显示</th>
              <th style="width:80px">筛选器</th>
              <th style="width:60px">删除</th>
            </tr>
          </thead>
          <tbody id="fieldManagerBody">
            ${allFields.map((f, index) => renderFieldManagerRow(f, index, coreKeys)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  showModal('字段管理', bodyHTML,
    `<button class="btn btn-outline" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveFieldManager()">保存设置</button>`);
}

function renderFieldManagerRow(field, index, coreKeys) {
  const isCore = coreKeys.includes(field.key);
  const isInList = state.studentListColumns.includes(field.key);
  return `
    <tr data-key="${field.key}">
      <td>
        <div style="display:flex;gap:4px;flex-direction:column">
          <button class="btn btn-sm btn-outline" onclick="moveField(${index}, -1)" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn btn-sm btn-outline" onclick="moveField(${index}, 1)" ${index >= state.studentFields.length - 1 ? 'disabled' : ''}>↓</button>
        </div>
      </td>
      <td>
        <input type="text" class="input field-name-input" data-key="${field.key}" value="${escapeHtml(field.name)}" ${isCore ? 'disabled' : ''} style="min-width:120px">
        ${isCore ? '<span style="font-size:12px;color:var(--text-muted)">核心字段</span>' : ''}
      </td>
      <td style="text-align:center">
        <input type="checkbox" class="field-show" data-key="${field.key}" ${isInList || isCore ? 'checked' : ''} ${isCore ? 'disabled' : ''}>
      </td>
      <td style="text-align:center">
        <input type="checkbox" class="field-filter" data-key="${field.key}" ${field.filterable !== false ? 'checked' : ''} ${isCore ? 'disabled' : ''}>
      </td>
      <td style="text-align:center">
        ${isCore ? '<span style="color:var(--text-muted)">-</span>' : `<button class="btn btn-sm btn-danger" onclick="deleteField('${field.key}')">删除</button>`}
      </td>
    </tr>
  `;
}

// 在重新渲染字段管理器表格前，保存当前勾选状态到 state
function saveCheckboxStateBeforeRerender() {
  // 保存列表显示勾选
  const checkedKeys = new Set();
  document.querySelectorAll('.field-show:checked').forEach(cb => {
    checkedKeys.add(cb.dataset.key);
  });
  // 核心字段始终显示
  CORE_FIELDS.forEach(k => checkedKeys.add(k));
  // 更新 studentListColumns：保留 checked 的，移除 unchecked 的
  state.studentListColumns = state.studentListColumns.filter(k => checkedKeys.has(k));
  // 添加新勾选的
  checkedKeys.forEach(k => {
    if (!state.studentListColumns.includes(k)) state.studentListColumns.push(k);
  });

  // 保存筛选器勾选
  document.querySelectorAll('.field-filter').forEach(cb => {
    const key = cb.dataset.key;
    const field = state.studentFields.find(f => f.key === key);
    if (field) field.filterable = cb.checked;
  });
}

function moveField(index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= state.studentFields.length) return;
  // 先保存当前勾选状态
  saveCheckboxStateBeforeRerender();
  const temp = state.studentFields[index];
  state.studentFields[index] = state.studentFields[newIndex];
  state.studentFields[newIndex] = temp;
  // 重新渲染管理器
  const allFields = [...state.studentFields];
  document.getElementById('fieldManagerBody').innerHTML = allFields.map((f, i) => renderFieldManagerRow(f, i, CORE_FIELDS)).join('');
}

function addCustomField() {
  const input = document.getElementById('newFieldName');
  const name = input.value.trim();
  if (!name) { showToast('请输入字段名称', 'error'); return; }

  const key = columnToFieldKey(name);

  // 先保存当前勾选状态（在修改任何东西之前）
  saveCheckboxStateBeforeRerender();

  const existingField = state.studentFields.find(f => f.key === key);
  if (existingField) {
    // 字段已存在：自动开启列表显示
    if (!state.studentListColumns.includes(key)) {
      state.studentListColumns.push(key);
    }
    input.value = '';
    const allFields = [...state.studentFields];
    document.getElementById('fieldManagerBody').innerHTML = allFields.map((f, i) => renderFieldManagerRow(f, i, CORE_FIELDS)).join('');
    showToast(`字段「${existingField.name}」已存在，已自动开启列表显示`, 'success');
    return;
  }

  state.studentFields.push({
    key,
    name,
    system: false,
    type: 'text',
    filterable: true,
    showInList: true
  });
  // 新字段自动加入列表显示
  if (!state.studentListColumns.includes(key)) {
    state.studentListColumns.push(key);
  }

  input.value = '';
  const allFields = [...state.studentFields];
  document.getElementById('fieldManagerBody').innerHTML = allFields.map((f, i) => renderFieldManagerRow(f, i, CORE_FIELDS)).join('');
  showToast(`字段「${name}」已添加`, 'success');
}

function deleteField(key) {
  if (!confirm(`确定删除字段「${getFieldDisplayName(key)}」吗？该字段在学生数据中的值仍会保留，只是不再作为独立字段管理。`)) return;
  // 先保存当前勾选状态
  saveCheckboxStateBeforeRerender();
  state.studentFields = state.studentFields.filter(f => f.key !== key);
  state.studentListColumns = state.studentListColumns.filter(c => c !== key);
  const allFields = [...state.studentFields];
  document.getElementById('fieldManagerBody').innerHTML = allFields.map((f, i) => renderFieldManagerRow(f, i, CORE_FIELDS)).join('');
}

async function saveFieldManager() {
  // 读取所有字段名称
  document.querySelectorAll('.field-name-input').forEach(input => {
    const key = input.dataset.key;
    const field = state.studentFields.find(f => f.key === key);
    if (field && !CORE_FIELDS.includes(key)) {
      field.name = input.value.trim() || field.name;
    }
  });

  // 读取列表显示设置（核心字段始终显示）
  state.studentListColumns = [...CORE_FIELDS];
  document.querySelectorAll('.field-show:checked').forEach(cb => {
    const key = cb.dataset.key;
    if (!state.studentListColumns.includes(key)) state.studentListColumns.push(key);
  });

  // 读取筛选器设置
  document.querySelectorAll('.field-filter').forEach(cb => {
    const key = cb.dataset.key;
    const field = state.studentFields.find(f => f.key === key);
    if (field) field.filterable = cb.checked;
  });

  await saveStudentFieldConfig();
  closeModal();
  showToast('字段设置已保存', 'success');
  navigateTo('students');
}

// 成绩统计辅助函数
function getGradeStudent(grade) {
  return state.students.find(s => String(s.id) === String(grade.studentId));
}

function calcSemesterStats(semester, excludeNames = []) {
  const semGrades = state.grades.filter(g => g.semester === semester);
  const classStats = {};
  const failedStudents = new Set();
  const warningStudents = new Set();
  const studentSet = new Set();
  const { nameSet, typeSet } = parseExcludeRules(excludeNames);

  semGrades.forEach(g => {
    const student = getGradeStudent(g);
    if (!student) return;
    studentSet.add(String(g.studentId));
    const className = student.className || '未分班';
    if (!classStats[className]) {
      classStats[className] = { count: 0, totalScore: 0, totalCredit: 0 };
    }
    classStats[className].count++;

    let failCount = 0;
    (g.courses || []).forEach(c => {
      if (isCourseExcluded(c, nameSet, typeSet)) return;
      const score = parseFloat(c.score);
      const credit = parseFloat(c.credit) || 1;
      if (!isNaN(score)) {
        classStats[className].totalScore += score * credit;
        classStats[className].totalCredit += credit;
      }
      if (isCourseFailed(c)) failCount++;
    });

    if (failCount >= 1) failedStudents.add(String(g.studentId));
    if (failCount >= 2) warningStudents.add(String(g.studentId));
  });

  const classAvgs = Object.entries(classStats).map(([className, s]) => ({
    className,
    count: s.count,
    avg: s.totalCredit > 0 ? s.totalScore / s.totalCredit : null
  })).sort((a, b) => (b.avg || 0) - (a.avg || 0));

  return {
    totalStudents: studentSet.size,
    classAvgs,
    failedCount: failedStudents.size,
    warningCount: warningStudents.size
  };
}

function renderGradeStatsPanel(semester, excludeNames = []) {
  const stats = calcSemesterStats(semester, excludeNames);
  const allCourses = [...new Set(state.grades.filter(g => g.semester === semester).flatMap(g => (g.courses || []).map(c => c.name)))].sort();

  return `
    <div class="grade-stats-panel" id="gradeStatsPanel">
      <div class="grade-stats-header">
        <select class="select" id="gradeStatsSemester" onchange="changeGradeStatsSemester()">
          ${[...new Set(state.grades.map(g => g.semester))].sort().reverse().map(s => `<option value="${s}" ${s === semester ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <button class="btn btn-outline" onclick="openExcludeCoursesModal('${semester}')">⚙️ 剔除课程</button>
      </div>
      <div class="grade-stats-grid">
        <div class="grade-stat-card">
          <div class="grade-stat-value">${stats.totalStudents}</div>
          <div class="grade-stat-label">参与统计人数</div>
        </div>
        <div class="grade-stat-card warn-red">
          <div class="grade-stat-value">${stats.failedCount}</div>
          <div class="grade-stat-label">挂科人数</div>
        </div>
        <div class="grade-stat-card warn-orange">
          <div class="grade-stat-value">${stats.warningCount}</div>
          <div class="grade-stat-label">学业预警人数</div>
        </div>
      </div>
      ${excludeNames.length > 0 ? `<div class="grade-exclude-tip">已剔除：${excludeNames.map(escapeHtml).join('、')}</div>` : ''}
      <div class="grade-class-avg">
        <div class="grade-class-avg-title">各班级加权平均分</div>
        <div class="grade-class-avg-list">
          ${stats.classAvgs.map(c => `
            <div class="grade-class-avg-item">
              <span class="grade-class-name">${escapeHtml(c.className)}</span>
              <span class="grade-class-count">${c.count}人</span>
              <span class="grade-class-score">${c.avg?.toFixed(2) || '-'}</span>
            </div>
          `).join('') || '<div class="empty-text">暂无班级数据</div>'}
        </div>
      </div>
    </div>
  `;
}

function changeGradeStatsSemester() {
  const semester = document.getElementById('gradeStatsSemester').value;
  const excludeNames = state.gradeExcludeCourses?.[semester] || [];
  const panel = document.getElementById('gradeStatsPanel');
  if (panel) panel.outerHTML = renderGradeStatsPanel(semester, excludeNames);
}

function openExcludeCoursesModal(semester) {
  const semesterGrades = state.grades.filter(g => g.semester === semester);
  const allCourses = [...new Set(semesterGrades.flatMap(g => (g.courses || []).map(c => c.name)))].sort();
  const allTypes = [...new Set(semesterGrades.flatMap(g => (g.courses || []).map(c => c.courseType || '其他')))].sort();
  const selected = new Set(state.gradeExcludeCourses?.[semester] || []);

  const courseListHtml = allCourses.length
    ? allCourses.map(c => `
        <label class="exclude-check-item">
          <input type="checkbox" value="${escapeHtml(c)}" class="exclude-course-cb" ${selected.has(c) ? 'checked' : ''}>
          <span>${escapeHtml(c)}</span>
        </label>
      `).join('')
    : '<div class="empty-text">本学期暂无课程名称数据</div>';

  const typeListHtml = allTypes.length
    ? allTypes.map(t => `
        <label class="exclude-check-item">
          <input type="checkbox" value="TYPE:${escapeHtml(t)}" class="exclude-course-type-cb" ${selected.has(`TYPE:${t}`) ? 'checked' : ''}>
          <span>${escapeHtml(t)}</span>
        </label>
      `).join('')
    : '<div class="empty-text">本学期暂无课程类型数据</div>';

  showModal('剔除课程（不参与统计）', `
    <div style="max-height:420px;overflow-y:auto;padding:4px">
      <div class="exclude-section">
        <div class="exclude-section-title">按课程名称剔除</div>
        <div class="exclude-check-list">${courseListHtml}</div>
      </div>
      <div class="exclude-section" style="margin-top:12px">
        <div class="exclude-section-title">按课程类型剔除</div>
        <div class="exclude-check-list">${typeListHtml}</div>
      </div>
    </div>
  `, `
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" onclick="saveExcludeCourses('${semester}')">确定</button>
  `);
}

function saveExcludeCourses(semester) {
  const courseNames = [...document.querySelectorAll('.exclude-course-cb:checked')].map(cb => cb.value);
  const courseTypes = [...document.querySelectorAll('.exclude-course-type-cb:checked')].map(cb => cb.value);
  const checked = [...courseNames, ...courseTypes];
  if (!state.gradeExcludeCourses) state.gradeExcludeCourses = {};
  state.gradeExcludeCourses[semester] = checked;
  closeModal();
  const panel = document.getElementById('gradeStatsPanel');
  if (panel) panel.outerHTML = renderGradeStatsPanel(semester, checked);
  // 如果当前在排名页，同时刷新排名
  if (document.getElementById('gradeRankBody')) updateGradeRanking();
  showToast('已更新剔除课程，统计已重新计算', 'success');
}

// ---------- 学业成绩 ----------
// ---------- 学业成绩（排名制） ----------
MODULE_RENDERERS.grades = async function(container) {
  state.grades = (await dbGetAll('grades')).filter(g => g && typeof g.weightedScore === 'number');
  state.students = await dbGetAll('students');
  state.assessments = await dbGetAll('assessments');

  const semesters = [...new Set(state.grades.map(g => g.semester))].sort();
  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">学业成绩 · 排名管理</div>
          <div class="card-subtitle">${state.grades.length} 条排名记录 · ${semesters.length} 个学期</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="triggerGradeRankImport()">📥 导入成绩排名</button>
          <button class="btn btn-outline" onclick="exportGradeRanking()">📤 导出排名</button>
        </div>
      </div>
      <div class="tabs" id="gradeTabs">
        <button class="tab active" onclick="switchGradeTab('ranking', this)">成绩排名</button>
        <button class="tab" onclick="switchGradeTab('trend', this)">趋势分析</button>
        <button class="tab" onclick="switchGradeTab('compare', this)">学业vs综测对比</button>
      </div>
      <div id="gradeTabContent"></div>
    </div>
  `;
  renderGradeRanking();
};

function switchGradeTab(tab, btn) {
  document.querySelectorAll('#gradeTabs .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  if (tab === 'ranking') renderGradeRanking();
  else if (tab === 'trend') renderGradeTrend();
  else if (tab === 'compare') renderGradeCompare();
}

function triggerGradeRankImport() {
  state.fileImportCallback = handleGradeExcelImport;
  document.getElementById('fileInput').click();
}

function renderGradeRanking() {
  const container = document.getElementById('gradeTabContent');
  const semesters = [...new Set(state.grades.map(g => g.semester))].sort();
  if (semesters.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">暂无成绩排名数据，请点击「导入成绩排名」</div></div>';
    return;
  }
  container.innerHTML = `
    <div class="filter-bar">
      <select class="select" id="gradeSemester" onchange="updateGradeRanking()">
        ${semesters.map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
      <select class="select" id="gradeClassFilter" onchange="updateGradeRanking()">
        <option value="">全部班级</option>
        ${[...new Set(state.students.map(s => s.className).filter(Boolean))].sort().map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div class="table-wrapper">
      <table class="data-table">
        <thead><tr><th>排名</th><th>学号</th><th>姓名</th><th>班级</th><th>加权总分</th></tr></thead>
        <tbody id="gradeRankBody"></tbody>
      </table>
    </div>
  `;
  updateGradeRanking();
}

function updateGradeRanking() {
  const semester = document.getElementById('gradeSemester').value;
  const classFilter = document.getElementById('gradeClassFilter')?.value || '';
  const studentMap = {};
  state.students.forEach(s => { studentMap[s.id] = s; });
  let rows = state.grades.filter(g => g.semester === semester).map(g => {
    const st = studentMap[g.studentId];
    if (!st) return null;
    if (classFilter && st.className !== classFilter) return null;
    return { st, score: g.weightedScore, rank: g.overallRank };
  }).filter(Boolean);
  rows.sort((a, b) => ((a.rank != null ? a.rank : 9999) - (b.rank != null ? b.rank : 9999)) || ((b.score || 0) - (a.score || 0)));
  document.getElementById('gradeRankBody').innerHTML = rows.map((r, i) => `
    <tr class="row-clickable" onclick="showStudentDetail(${r.st.id})">
      <td><span class="tag ${i < 3 ? 'tag-red' : 'tag-blue'}">${r.rank != null ? r.rank : i + 1}</span></td>
      <td>${r.st.studentId}</td>
      <td>${r.st.name}</td>
      <td>${r.st.className || '-'}</td>
      <td style="font-weight:700">${r.score != null ? r.score.toFixed(2) : '-'}</td>
    </tr>
  `).join('') || '<tr><td colspan="5"><div class="empty-state"><div class="empty-text">该条件下暂无数据</div></div></td></tr>';
}

function renderGradeTrend() {
  const container = document.getElementById('gradeTabContent');
  if (state.grades.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📈</div><div class="empty-text">暂无成绩排名数据</div></div>';
    return;
  }
  container.innerHTML = `
    <div class="filter-bar">
      <select class="select" id="gradeTrendStudent" onchange="updateGradeTrend()">
        ${state.students.slice().sort((a, b) => (a.className || '').localeCompare(b.className || '')).map(s => `<option value="${s.id}">${(s.className || '')} ${s.name}（${s.studentId}）</option>`).join('')}
      </select>
    </div>
    <div class="chart-container"><canvas id="gradeTrendChart"></canvas></div>
    <div class="table-wrapper" style="margin-top:12px">
      <table class="data-table">
        <thead><tr><th>学期</th><th>加权总分</th><th>排名</th></tr></thead>
        <tbody id="gradeTrendBody"></tbody>
      </table>
    </div>
  `;
  updateGradeTrend();
}

function updateGradeTrend() {
  const sid = document.getElementById('gradeTrendStudent').value;
  const studentMap = {};
  state.students.forEach(s => { studentMap[s.id] = s; });
  const st = studentMap[sid];
  const recs = state.grades.filter(g => String(g.studentId) === String(sid)).sort((a, b) => a.semester.localeCompare(b.semester));
  const labels = recs.map(r => r.semester);
  const scores = recs.map(r => r.weightedScore);
  const ranks = recs.map(r => r.overallRank);
  const body = document.getElementById('gradeTrendBody');
  if (body) body.innerHTML = recs.map(r => `<tr><td>${r.semester}</td><td>${r.weightedScore != null ? r.weightedScore.toFixed(2) : '-'}</td><td>${r.overallRank != null ? r.overallRank : '-'}</td></tr>`).join('') || '<tr><td colspan="3">暂无数据</td></tr>';
  const ctx = document.getElementById('gradeTrendChart');
  if (!ctx) return;
  if (state.charts.gradeTrend) state.charts.gradeTrend.destroy();
  state.charts.gradeTrend = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '加权总分', data: scores, borderColor: '#1E4E8C', backgroundColor: 'rgba(30,78,140,0.1)', fill: true, tension: 0.3, yAxisID: 'y' },
        { label: '排名', data: ranks, borderColor: '#E53E3E', backgroundColor: 'transparent', tension: 0.3, yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { position: 'left', title: { display: true, text: '加权总分' } },
        y1: { position: 'right', title: { display: true, text: '排名' }, reverse: true, grid: { drawOnChartArea: false } }
      },
      plugins: { title: { display: true, text: (st ? st.name + ' ' : '') + '学业成绩趋势' } }
    }
  });
}

function renderGradeCompare() {
  const container = document.getElementById('gradeTabContent');
  if (state.students.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-text">暂无学生数据</div></div>';
    return;
  }
  container.innerHTML = `
    <div class="filter-bar">
      <select class="select" id="compareStudent" onchange="updateGradeCompare()">
        ${state.students.slice().sort((a, b) => (a.className || '').localeCompare(b.className || '')).map(s => `<option value="${s.id}">${(s.className || '')} ${s.name}（${s.studentId}）</option>`).join('')}
      </select>
    </div>
    <div class="chart-container"><canvas id="compareChart"></canvas></div>
    <div class="table-wrapper" style="margin-top:12px">
      <table class="data-table">
        <thead><tr><th>学期/学年</th><th>学业加权总分</th><th>学业排名</th><th>综测总分</th><th>综测排名</th><th>位次差异(学业-综测)</th></tr></thead>
        <tbody id="compareBody"></tbody>
      </table>
    </div>
  `;
  updateGradeCompare();
}

function updateGradeCompare() {
  const sid = document.getElementById('compareStudent').value;
  const studentMap = {};
  state.students.forEach(s => { studentMap[s.id] = s; });
  const st = studentMap[sid];
  const gradeRecs = state.grades.filter(g => String(g.studentId) === String(sid)).sort((a, b) => a.semester.localeCompare(b.semester));
  const assessRecs = state.assessments.filter(a => String(a.studentId) === String(sid)).sort((a, b) => a.academicYear.localeCompare(b.academicYear));

  const gMap = {}; gradeRecs.forEach(r => { gMap[r.semester] = r; });
  const aMap = {}; assessRecs.forEach(r => { aMap[r.academicYear] = r; });

  const semGroups = {};
  state.grades.forEach(g => { if (typeof g.weightedScore === 'number') { (semGroups[g.semester] = semGroups[g.semester] || []).push(g); } });
  const gradeRankByKey = {};
  Object.keys(semGroups).forEach(s => { const arr = semGroups[s].slice().sort((x, y) => (y.weightedScore || 0) - (x.weightedScore || 0)); arr.forEach((g, i) => { gradeRankByKey[String(g.studentId) + '_' + s] = i + 1; }); });

  const yearGroups = {};
  state.assessments.forEach(a => { (yearGroups[a.academicYear] = yearGroups[a.academicYear] || []).push(a); });
  const assessRankByKey = {};
  Object.keys(yearGroups).forEach(y => { const arr = yearGroups[y].slice().sort((x, yy) => (yy.totalScore || 0) - (x.totalScore || 0)); arr.forEach((a, i) => { assessRankByKey[String(a.studentId) + '_' + y] = i + 1; }); });

  const allLabels = [...new Set([...gradeRecs.map(r => r.semester), ...assessRecs.map(r => r.academicYear)])].sort();
  const gData = allLabels.map(l => gMap[l] ? gMap[l].weightedScore : null);
  const aData = allLabels.map(l => aMap[l] ? aMap[l].totalScore : null);
  const gRankData = allLabels.map(l => gMap[l] ? (gMap[l].overallRank != null ? gMap[l].overallRank : gradeRankByKey[String(sid) + '_' + l]) : null);
  const aRankData = allLabels.map(l => aMap[l] ? (assessRankByKey[String(sid) + '_' + l] || null) : null);

  const body = document.getElementById('compareBody');
  if (body) {
    body.innerHTML = allLabels.map((l, i) => {
      const g = gMap[l], a = aMap[l];
      const gr = gRankData[i], ar = aRankData[i];
      let diff = '-';
      if (gr != null && ar != null) diff = gr - ar;
      return `<tr><td>${l}</td><td>${g ? g.weightedScore.toFixed(2) : '-'}</td><td>${gr != null ? gr : '-'}</td><td>${a ? a.totalScore.toFixed(2) : '-'}</td><td>${ar != null ? ar : '-'}</td><td>${diff}</td></tr>`;
    }).join('') || '<tr><td colspan="6">暂无数据</td></tr>';
  }
  const ctx = document.getElementById('compareChart');
  if (ctx) {
    if (state.charts.compare) state.charts.compare.destroy();
    state.charts.compare = new Chart(ctx.getContext('2d'), {
      type: 'line',
      data: { labels: allLabels, datasets: [
        { label: '学业排名', data: gRankData, borderColor: '#1E4E8C', tension: 0.3, yAxisID: 'y' },
        { label: '综测排名', data: aRankData, borderColor: '#E53E3E', tension: 0.3, yAxisID: 'y' }
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { reverse: true, title: { display: true, text: '排名（越小越好）' } } },
        plugins: { title: { display: true, text: (st ? st.name + ' ' : '') + '学业 vs 综测 排名对比' } }
      }
    });
  }
}

async function handleGradeExcelImport(file) {
  showLoading('正在解析成绩排名Excel...');
  try {
    const data = await readExcelFile(file);
    if (!data || data.length === 0) { hideLoading(); showToast('文件为空或格式不正确', 'error'); return; }
    const first = data[0];
    const colOf = (candidates) => {
      for (const c of candidates) {
        if (first.hasOwnProperty(c)) return c;
        const hit = Object.keys(first).find(k => k.replace(/\s/g, '').includes(c.replace(/\s/g, '')));
        if (hit) return hit;
      }
      return null;
    };
    const sidCol = colOf(['学号', '考号', '考生号']) || Object.keys(first)[0];
    const nameCol = colOf(['姓名', '学生姓名', '名字']);
    const semCol = colOf(['学期', '学年学期', '学期名称']);
    const scoreCol = colOf(['学分加权平均分', '加权总分', '学业加权总分', '加权平均成绩', '加权平均分', '总分', '成绩']) || Object.keys(first).find(k => k.includes('分'));
    const rankCol = colOf(['排名', '总排名', '名次', '位次']);

    if (!scoreCol) { hideLoading(); showToast('未能识别分数列，请检查表头是否包含“学分加权平均分”或“加权总分”等', 'error'); return; }

    let semesterBase = '';
    if (!semCol) {
      hideLoading();
      const base = await showPromptModal('成绩导入', '表格中没有“学期”列，请手动输入本次导入的学期', '如：2025-2026-1', '2025-2026-1');
      showLoading('正在解析成绩排名Excel...');
      if (!base) { hideLoading(); return; }
      semesterBase = base.trim();
      if (!semesterBase) { hideLoading(); showToast('学期名称不能为空', 'error'); return; }
    }

    let useSemPrompt = false;
    if (semCol) {
      const sampleSem = String(data.find(r => r[semCol])?.[semCol] || '');
      const semNum = parseInt(sampleSem, 10);
      if (String(semNum) === sampleSem.replace(/\s/g, '') && [1, 2].includes(semNum)) {
        useSemPrompt = true;
        hideLoading();
        const base = await showPromptModal('成绩导入', '检测到学期列为数字 1/2，请输入学年基准', '如：2025-2026', '2025-2026');
        showLoading('正在解析成绩排名Excel...');
        if (!base) { hideLoading(); return; }
        semesterBase = base.trim();
        if (!/^\d{4}-\d{4}$/.test(semesterBase)) { hideLoading(); showToast('学年基准格式应为 2025-2026，请重新导入', 'error'); return; }
      }
    }

    const students = await dbGetAll('students');
    const bySid = {}, byName = {};
    students.forEach(s => { const sid = normalizeStudentId(s.studentId); if (sid) bySid[sid] = s; const nm = String(s.name || '').trim(); if (nm) byName[nm] = s; });
    const existing = await dbGetAll('grades');
    const existByKey = {};
    existing.forEach(g => { if (g && g.studentId && g.semester) existByKey[String(g.studentId) + '__' + g.semester] = g; });

    const toAdd = [], toUpdate = [];
    let unmatched = 0;
    const unmatchedSamples = [];
    for (const row of data) {
      const sidRaw = String(row[sidCol] || '').trim();
      const sid = normalizeStudentId(sidRaw);
      const nm = nameCol ? String(row[nameCol] || '').trim() : '';
      const student = (sid && bySid[sid]) || (nm && byName[nm]) || null;
      if (!student) {
        unmatched++;
        if (unmatchedSamples.length < 5) unmatchedSamples.push(sid || nm || '未知');
        continue;
      }
      let semester = semCol ? String(row[semCol] || '').trim() : semesterBase;
      if (useSemPrompt && semesterBase) { const n = parseInt(semester, 10); if ([1, 2].includes(n)) semester = semesterBase + '-' + n; }
      const score = parseFloat(String(row[scoreCol] || '').replace(/[^\d.]/g, ''));
      const rank = rankCol ? parseInt(String(row[rankCol] || '').replace(/[^\d]/g, ''), 10) : null;
      if (isNaN(score)) continue;
      const key = String(student.id) + '__' + semester;
      const rec = { studentId: String(student.id), semester, weightedScore: score, overallRank: (rank && !isNaN(rank)) ? rank : null, className: student.className || '', updatedAt: Date.now() };
      if (existByKey[key]) { rec.id = existByKey[key].id; rec.createdAt = existByKey[key].createdAt || Date.now(); toUpdate.push(rec); }
      else { rec.createdAt = Date.now(); toAdd.push(rec); }
    }

    for (const rec of toUpdate) await dbPut('grades', rec);
    if (toAdd.length) await dbAddBatch('grades', toAdd);

    hideLoading();
    let msg = `导入完成：新增 ${toAdd.length} 条，更新 ${toUpdate.length} 条`;
    if (unmatched > 0) {
      msg += `，${unmatched} 人未匹配（${unmatchedSamples.join('、')}等）`;
      if (unmatched === data.length) msg += '。请先到「学生管理」导入学生基础信息，再导入成绩排名。';
    }
    showToast(msg, unmatched === data.length ? 'error' : (unmatched > 0 ? 'warning' : 'success'));
    state.grades = (await dbGetAll('grades')).filter(g => g && typeof g.weightedScore === 'number');
    navigateTo('grades');
  } catch (err) {
    hideLoading();
    console.error(err);
    showToast('导入失败：' + err.message, 'error');
  }
}

async function exportGradeRanking() {
  const semesters = [...new Set(state.grades.map(g => g.semester))].sort();
  if (semesters.length === 0) { showToast('暂无数据', 'error'); return; }
  const studentMap = {}; state.students.forEach(s => { studentMap[s.id] = s; });
  let all = [];
  for (const sem of semesters) {
    const recs = state.grades.filter(g => g.semester === sem).map(g => ({ st: studentMap[g.studentId], g })).filter(x => x.st)
      .sort((a, b) => ((a.g.overallRank != null ? a.g.overallRank : 9999) - (b.g.overallRank != null ? b.g.overallRank : 9999)) || ((b.g.weightedScore || 0) - (a.g.weightedScore || 0)));
    recs.forEach((x, i) => { all.push({ '学期': sem, '排名': x.g.overallRank != null ? x.g.overallRank : i + 1, '学号': x.st.studentId, '姓名': x.st.name, '班级': x.st.className || '', '加权总分': x.g.weightedScore != null ? x.g.weightedScore.toFixed(2) : '' }); });
    all.push({ '学期': '', '排名': '', '学号': '', '姓名': '', '班级': '', '加权总分': '' });
  }
  exportToExcel(all, `学业成绩排名_${formatDate(new Date())}.xlsx`, '学业成绩排名');
  showToast('已导出', 'success');
}
// ---------- 综测管理 ----------
MODULE_RENDERERS.assessment = async function(container) {
  state.assessments = await dbGetAll('assessments');
  state.students = await dbGetAll('students');
  const years = [...new Set(state.assessments.map(a => a.academicYear))].sort().reverse();
  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">综合素质测评管理</div>
          <div class="card-subtitle">${state.assessments.length} 条综测记录 · ${years.length} 个学年</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="triggerAssessmentImport()">📥 导入综测Excel</button>
          <button class="btn btn-outline" onclick="exportAssessmentRanking()">📤 导出排名</button>
        </div>
      </div>
      <div class="tabs" id="assessTabs">
        <button class="tab active" onclick="switchAssessTab('ranking', this)">综测排名</button>
        <button class="tab" onclick="switchAssessTab('trend', this)">趋势分析</button>
      </div>
      <div id="assessTabContent"></div>
    </div>
  `;
  renderAssessRanking();
};

function switchAssessTab(tab, btn) {
  document.querySelectorAll('#assessTabs .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  if (tab === 'ranking') renderAssessRanking();
  else if (tab === 'trend') renderAssessTrend();
}

function renderAssessRanking() {
  const container = document.getElementById('assessTabContent');
  const years = [...new Set(state.assessments.map(a => a.academicYear))].sort().reverse();
  if (years.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">暂无综测数据，请点击「导入综测Excel」</div></div>';
    return;
  }
  container.innerHTML = `
    <div class="filter-bar">
      <select class="select" id="assessYear" onchange="updateAssessRanking()">
        ${years.map(y => `<option value="${y}">${y}</option>`).join('')}
      </select>
      <select class="select" id="assessClass" onchange="updateAssessRanking()">
        <option value="">全部班级</option>
        ${[...new Set(state.students.map(s => s.className).filter(Boolean))].sort().map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div class="table-wrapper">
      <table class="data-table">
        <thead><tr><th>排名</th><th>学号</th><th>姓名</th><th>班级</th><th>综测总分</th></tr></thead>
        <tbody id="assessRankBody"></tbody>
      </table>
    </div>
  `;
  updateAssessRanking();
}

function updateAssessRanking() {
  const year = document.getElementById('assessYear').value;
  const classFilter = document.getElementById('assessClass')?.value || '';
  const studentMap = {};
  state.students.forEach(s => { studentMap[s.id] = s; });
  let rows = state.assessments.filter(a => a.academicYear === year).map(a => {
    const st = studentMap[a.studentId];
    if (!st) return null;
    if (classFilter && st.className !== classFilter) return null;
    return { st, score: a.totalScore };
  }).filter(Boolean).sort((a, b) => (b.score || 0) - (a.score || 0));
  document.getElementById('assessRankBody').innerHTML = rows.map((r, i) => `
    <tr class="row-clickable" onclick="showStudentDetail(${r.st.id})">
      <td><span class="tag ${i < 3 ? 'tag-red' : 'tag-blue'}">${i + 1}</span></td>
      <td>${r.st.studentId}</td>
      <td>${r.st.name}</td>
      <td>${r.st.className || '-'}</td>
      <td style="font-weight:700">${r.score != null ? r.score.toFixed(2) : '-'}</td>
    </tr>
  `).join('') || '<tr><td colspan="5"><div class="empty-state"><div class="empty-text">暂无数据</div></div></td></tr>';
}

function renderAssessTrend() {
  const container = document.getElementById('assessTabContent');
  if (state.assessments.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📈</div><div class="empty-text">暂无综测数据</div></div>';
    return;
  }
  container.innerHTML = `
    <div class="filter-bar">
      <select class="select" id="assessTrendStudent" onchange="updateAssessTrend()">
        ${state.students.slice().sort((a, b) => (a.className || '').localeCompare(b.className || '')).map(s => `<option value="${s.id}">${(s.className || '')} ${s.name}（${s.studentId}）</option>`).join('')}
      </select>
    </div>
    <div class="chart-container"><canvas id="assessTrendChart"></canvas></div>
    <div class="table-wrapper" style="margin-top:12px">
      <table class="data-table">
        <thead><tr><th>学年</th><th>综测总分</th><th>排名</th></tr></thead>
        <tbody id="assessTrendBody"></tbody>
      </table>
    </div>
  `;
  updateAssessTrend();
}

function updateAssessTrend() {
  const sid = document.getElementById('assessTrendStudent').value;
  const studentMap = {};
  state.students.forEach(s => { studentMap[s.id] = s; });
  const st = studentMap[sid];
  const recs = state.assessments.filter(a => String(a.studentId) === String(sid)).sort((a, b) => a.academicYear.localeCompare(b.academicYear));
  const yearGroups = {};
  state.assessments.forEach(a => { (yearGroups[a.academicYear] = yearGroups[a.academicYear] || []).push(a); });
  const rankMap = {};
  Object.keys(yearGroups).forEach(y => { const arr = yearGroups[y].slice().sort((x, yy) => (yy.totalScore || 0) - (x.totalScore || 0)); arr.forEach((a, i) => { rankMap[String(a.studentId) + '_' + y] = i + 1; }); });
  const labels = recs.map(r => r.academicYear);
  const scores = recs.map(r => r.totalScore);
  const ranks = recs.map(r => rankMap[String(sid) + '_' + r.academicYear]);
  const body = document.getElementById('assessTrendBody');
  if (body) body.innerHTML = recs.map((r, i) => `<tr><td>${r.academicYear}</td><td>${r.totalScore != null ? r.totalScore.toFixed(2) : '-'}</td><td>${ranks[i] != null ? ranks[i] : '-'}</td></tr>`).join('') || '<tr><td colspan="3">暂无数据</td></tr>';
  const ctx = document.getElementById('assessTrendChart');
  if (ctx) {
    if (state.charts.assessTrend) state.charts.assessTrend.destroy();
    state.charts.assessTrend = new Chart(ctx.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: '综测总分', data: scores, borderColor: '#38A169', backgroundColor: 'rgba(56,161,105,0.1)', fill: true, tension: 0.3, yAxisID: 'y' },
          { label: '排名', data: ranks, borderColor: '#E53E3E', tension: 0.3, yAxisID: 'y1' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          y: { position: 'left', title: { display: true, text: '综测总分' } },
          y1: { position: 'right', title: { display: true, text: '排名' }, reverse: true, grid: { drawOnChartArea: false } }
        },
        plugins: { title: { display: true, text: (st ? st.name + ' ' : '') + '综测趋势' } }
      }
    });
  }
}
function triggerAssessmentImport() {
  state.fileImportCallback = handleAssessmentImport;
  document.getElementById('fileInput').click();
}

async function handleAssessmentImport(file) {
  showLoading('正在解析综测Excel...');
  try {
    const data = await readExcelFile(file);
    if (!data || data.length === 0) { hideLoading(); showToast('文件为空', 'error'); return; }

    const year = await showPromptModal('综测导入', '请输入本表学年', '如：2025-2026', '');
    if (!year) { hideLoading(); return; }

    const students = await dbGetAll('students');
    let count = 0, unmatched = 0;

    for (const row of data) {
      const sid = String(row['学号'] || row['学 号'] || Object.values(row)[0] || '').trim();
      if (!sid) continue;
      const student = students.find(s => s.studentId === sid);
      if (!student) { unmatched++; continue; }

      const totalScore = parseFloat(row['总分'] || row['综测总分'] || row['综合素质测评总分'] || row['总成绩'] || '0');
      const items = [];

      // 尝试解析各项分数
      const itemKeys = Object.keys(row).filter(k => !k.includes('学号') && !k.includes('姓名') && !k.includes('总分') && !k.includes('班级') && !k.includes('专业') && !k.includes('年级'));
      itemKeys.forEach(k => {
        const val = parseFloat(row[k]);
        if (!isNaN(val) && val > 0) items.push({ name: k, score: val });
      });

      const existing = await dbGetByIndex('assessments', 'studentId', String(student.id));
      const existYear = existing.find(a => a.academicYear === year);
      const assessData = { academicYear: year, studentId: String(student.id), totalScore: totalScore || (items.length > 0 ? items.reduce((s,i)=>s+i.score,0) : 0), items };

      if (existYear) {
        await dbPut('assessments', { ...existYear, ...assessData, id: existYear.id });
      } else {
        await dbAdd('assessments', assessData);
      }
      count++;
    }

    hideLoading();
    showToast(`导入完成：${count} 人综测数据已更新${unmatched > 0 ? `，${unmatched} 人未匹配` : ''}`, 'success');
    state.assessments = await dbGetAll('assessments');
    navigateTo('assessment');
  } catch (err) {
    hideLoading();
    showToast('导入失败：' + err.message, 'error');
  }
}

async function exportAssessmentRanking() {
  const years = [...new Set(state.assessments.map(a => a.academicYear))].sort().reverse();
  if (years.length === 0) { showToast('暂无综测数据', 'error'); return; }

  let allData = [];
  const studentMap = {};
  state.students.forEach(s => { studentMap[s.id] = s; });

  for (const year of years) {
    const yearAssess = state.assessments.filter(a => a.academicYear === year);
    let ranked = yearAssess.map(a => {
      const student = studentMap[a.studentId];
      if (!student) return null;
      return { student, score: a.totalScore };
    }).filter(Boolean).sort((a,b) => (b.score||0)-(a.score||0));

    ranked.forEach((r, i) => {
      allData.push({
        '学年': year, '排名': i+1, '学号': r.student.studentId, '姓名': r.student.name,
        '班级': r.student.className||'', '综测总分': r.score?.toFixed(2)||''
      });
    });
    allData.push({ '学年': '', '排名': '', '学号': '', '姓名': '', '班级': '', '综测总分': '' });
  }
  exportToExcel(allData, `综测排名_${formatDate(new Date())}.xlsx`, '综测排名');
  showToast('已导出', 'success');
}

// ---------- 生涯规划 ----------
MODULE_RENDERERS.career = async function(container) {
  state.students = await dbGetAll('students');
  const goals = { '考研': 0, '考公': 0, '就业求职': 0, '出国留学': 0, '暂未规划': 0 };
  const classGoals = {};

  state.students.forEach(s => {
    const goal = s.careerGoal || '暂未规划';
    if (goals.hasOwnProperty(goal)) goals[goal]++;
    const cn = s.className || '未分班';
    if (!classGoals[cn]) classGoals[cn] = { '考研': 0, '考公': 0, '就业求职': 0, '出国留学': 0, '暂未规划': 0 };
    if (classGoals[cn].hasOwnProperty(goal)) classGoals[cn][goal]++;
  });

  const total = state.students.length;

  container.innerHTML = `
    <div class="stat-grid">
      ${Object.entries(goals).map(([goal, count]) => {
        const pct = total > 0 ? ((count/total)*100).toFixed(1) : 0;
        const colors = { '考研':'stat-blue', '考公':'stat-green', '就业求职':'stat-orange', '出国留学':'stat-red', '暂未规划':'stat-orange' };
        return `<div class="stat-card ${colors[goal]||'stat-blue'}">
          <div class="stat-value">${count}</div>
          <div class="stat-label">${goal} (${pct}%)</div>
        </div>`;
      }).join('')}
    </div>

    <div class="card">
      <div class="card-header"><div class="card-title">生涯规划总览</div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="chart-container"><canvas id="careerPie2"></canvas></div>
        <div class="chart-container"><canvas id="careerBar"></canvas></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-title">各班级生涯规划分布</div></div>
      <div class="chart-container"><canvas id="careerClassBar"></canvas></div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-title">班级明细</div></div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>班级</th><th>考研</th><th>考公</th><th>就业求职</th><th>出国留学</th><th>暂未规划</th><th>合计</th></tr></thead>
          <tbody>
            ${Object.entries(classGoals).map(([cn, goals]) => {
              const sum = Object.values(goals).reduce((a,b)=>a+b,0);
              return `<tr><td>${cn}</td>${Object.values(goals).map(g => `<td>${g}</td>`).join('')}<td><strong>${sum}</strong></td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // 饼图
  const ctx1 = document.getElementById('careerPie2').getContext('2d');
  new Chart(ctx1, {
    type: 'pie',
    data: {
      labels: Object.keys(goals),
      datasets: [{ data: Object.values(goals), backgroundColor: ['#1E4E8C','#38A169','#D69E2E','#E53E3E','#718096'], borderWidth: 2, borderColor: '#fff' }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });

  // 柱状图
  const ctx2 = document.getElementById('careerBar').getContext('2d');
  new Chart(ctx2, {
    type: 'bar',
    data: { labels: Object.keys(goals), datasets: [{ label: '人数', data: Object.values(goals), backgroundColor: '#1E4E8C' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: '生涯目标人数分布' } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
  });

  // 班级堆叠柱状图
  const ctx3 = document.getElementById('careerClassBar').getContext('2d');
  const classNames = Object.keys(classGoals);
  new Chart(ctx3, {
    type: 'bar',
    data: {
      labels: classNames,
      datasets: Object.keys(goals).map((goal, i) => ({
        label: goal,
        data: classNames.map(cn => classGoals[cn][goal]),
        backgroundColor: ['#1E4E8C','#38A169','#D69E2E','#E53E3E','#718096'][i]
      }))
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } } }, plugins: { title: { display: true, text: '各班级生涯规划堆叠图' } } }
  });
};

// ---------- 竞赛指导 ----------
const COMPETITIONS = {
  '创新创业类': [
    { name: '中国国际大学生创新大赛（原互联网+）', url: 'https://cy.ncss.cn/', desc: '全国最大规模创新创业赛事' },
    { name: '"挑战杯"全国大学生课外学术科技作品竞赛', url: 'https://www.tiaozhan.com/', desc: '大学生学术科技顶级赛事' },
    { name: '全国大学生电子商务"创新、创意及创业"挑战赛（三创赛）', url: 'http://www.3chuang.net/', desc: '电子商务领域创新竞赛' },
    { name: '"学创杯"全国大学生创业综合模拟大赛', url: 'http://www.bingowit.com/', desc: '创业模拟实战竞赛' },
    { name: '"创青春"全国大学生创业大赛', url: 'https://www.chuangqingchun.net/', desc: '共青团中央主办创业赛事' },
    { name: 'iCAN大学生创新创业大赛', url: 'http://www.g-ican.com/', desc: '原创微纳领域创新赛事' }
  ],
  '职业规划与就业类': [
    { name: '全国大学生职业规划大赛', url: 'https://www.ncss.cn/', desc: '大学生职业规划国家级赛事' },
    { name: '全国大学生市场调查与分析大赛（正大杯）', url: 'http://www.china-cssa.org/', desc: '市场调查研究分析竞赛' }
  ],
  '社会实践与志愿服务类': [
    { name: '全国大中专学生"三下乡"社会实践', url: 'https://sxx.youth.cn/', desc: '暑期文化科技卫生三下乡' },
    { name: '"返家乡"社会实践活动', url: 'https://fjx.youth.cn/', desc: '寒假返乡社会实践' },
    { name: '大学生志愿服务西部计划', url: 'https://xibu.youth.cn/', desc: '西部志愿服务项目' },
    { name: '中国青年志愿服务项目大赛', url: 'https://www.chinavolunteer.mca.gov.cn/', desc: '志愿服务领域赛事' }
  ],
  '文化艺术类': [
    { name: '中华经典诵写讲大赛', url: 'https://www.jingdiansxw.cn/', desc: '经典诵读书法大赛' },
    { name: '全国大学生艺术展演', url: 'http://www.moe.gov.cn/', desc: '大学生艺术教育成果展' },
    { name: '外研社·国才杯全国英语大赛', url: 'https://uchallenge.unipus.cn/', desc: '英语演讲写作阅读大赛' }
  ],
  '学术科技类': [
    { name: '全国大学生数学建模竞赛', url: 'http://www.mcm.edu.cn/', desc: '数学建模顶级赛事' },
    { name: '全国大学生市场调查与分析大赛', url: 'http://www.china-cssa.org/', desc: '市场调研学术竞赛' },
    { name: '全国大学生广告艺术大赛（大广赛）', url: 'http://www.sun-aea.net/', desc: '广告创意设计赛事' },
    { name: '全国大学生节能减排社会实践与科技竞赛', url: 'http://www.jnjp.org.cn/', desc: '节能减排创新竞赛' }
  ],
  '思政与理论类': [
    { name: '全国高校学生讲思政课公开课展示活动', url: 'http://www.moe.gov.cn/', desc: '大学生讲思政课比赛' },
    { name: '"我心中的思政课"全国高校学生微电影展示活动', url: 'http://www.moe.gov.cn/', desc: '思政主题微电影创作' },
    { name: '全国大学生网络文化节', url: 'http://www.moe.gov.cn/', desc: '网络文化作品创作展示' }
  ]
};

MODULE_RENDERERS.competitions = function(container) {
  let html = '';
  for (const [category, comps] of Object.entries(COMPETITIONS)) {
    html += `<div class="section-title">${category}</div>`;
    html += `<div class="competition-grid">`;
    comps.forEach(c => {
      html += `<a href="${c.url}" target="_blank" rel="noopener noreferrer" class="competition-card">
        <div class="comp-name">${c.name}</div>
        <div class="comp-desc">${c.desc}</div>
        <div class="comp-link">🔗 点击访问官方赛事网站</div>
      </a>`;
    });
    html += `</div>`;
  }
  container.innerHTML = html;
};

// 教学周智能计算
async function getWeekInfo() {
  const semesterStart = await getSetting('semesterStart');
  const totalWeeks = await getSetting('totalWeeks', 20);
  if (!semesterStart) return null;
  const start = new Date(semesterStart);
  const now = new Date();
  const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  const week = Math.floor(diffDays / 7) + 1;
  const isOdd = week % 2 === 1;
  return {
    week,
    totalWeeks,
    isOdd,
    isEven: !isOdd,
    inRange: week > 0 && week <= totalWeeks,
    weekType: isOdd ? '单周' : '双周',
    label: `第${week}周·${isOdd ? '单周' : '双周'}`
  };
}

// 判断某门课在本周是否上课
function isCourseThisWeek(course, weekInfo) {
  if (!weekInfo) return true; // 未设置学期时全部显示
  if (!course.weekType || course.weekType === 'all') return true;
  if (course.weekType === 'odd') return weekInfo.isOdd;
  if (course.weekType === 'even') return weekInfo.isEven;
  return true;
}

// ---------- 校历课表 ----------
MODULE_RENDERERS.calendar = async function(container) {
  const scheduleImage = await getSetting('calendarImage');
  const schedule = await getSetting('schedule', []);
  const semesterStart = await getSetting('semesterStart');
  const totalWeeks = await getSetting('totalWeeks', 20);

  // 智能计算教学周
  const wi = await getWeekInfo();
  const weekInfo = wi ? `${wi.label}` : '';
  const weekSub = wi ? `共${wi.totalWeeks}周 · ${wi.inRange ? '进行中' : (wi.week < 1 ? '未开始' : '已结束')}` : '未设置学期开始日期';

  // 下一个法定假日
  const holidays = [
    { name: '国庆节', date: '10-01' }, { name: '元旦', date: '01-01' },
    { name: '春节', date: '01-29' }, { name: '清明节', date: '04-05' },
    { name: '劳动节', date: '05-01' }, { name: '端午节', date: '06-19' },
    { name: '中秋节', date: '09-25' }
  ];
  const now = new Date();
  let nextHoliday = null, minDiff = Infinity;
  holidays.forEach(h => {
    const [m, d] = h.date.split('-').map(Number);
    let hDate = new Date(now.getFullYear(), m - 1, d);
    if (hDate < now) hDate.setFullYear(now.getFullYear() + 1);
    const diff = Math.ceil((hDate - now) / (1000 * 60 * 60 * 24));
    if (diff < minDiff) { minDiff = diff; nextHoliday = { ...h, daysLeft: diff }; }
  });

  const timeSlots = [
    { period: '第1-2节', time: '08:00-09:35' }, { period: '第3-4节', time: '09:50-11:25' },
    { period: '第5-6节', time: '11:40-13:15' }, { period: '第7-8节', time: '14:00-15:35' },
    { period: '第9-10节', time: '15:50-17:25' }, { period: '第11-12节', time: '19:00-20:35' }
  ];
  const days = ['周一','周二','周三','周四','周五','周六','周日'];
  const currentDayIndex = (now.getDay() + 6) % 7;

  // 今日课程（按单双周过滤）
  const todayCourses = schedule
    .filter(s => s.day === currentDayIndex && isCourseThisWeek(s, wi))
    .sort((a, b) => a.slot - b.slot);
  const todayActiveCount = todayCourses.length;

  // 本周课程数（按单双周过滤后的实际数）
  const weekActiveCount = schedule.filter(s => isCourseThisWeek(s, wi)).length;

  container.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card stat-blue">
        <div class="stat-value">${wi ? `第${wi.week}周` : '未设置'}</div>
        <div class="stat-label">${wi ? wi.weekType : '教学周'}</div>
      </div>
      ${nextHoliday ? `<div class="stat-card stat-green">
        <div class="stat-value">${nextHoliday.daysLeft}天</div>
        <div class="stat-label">距${nextHoliday.name}</div>
      </div>` : ''}
      <div class="stat-card stat-orange">
        <div class="stat-value">${todayActiveCount}</div>
        <div class="stat-label">今日课程数</div>
      </div>
      <div class="stat-card stat-red">
        <div class="stat-value">${weekActiveCount}</div>
        <div class="stat-label">本周总课程</div>
      </div>
    </div>

    <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;padding:8px 12px;background:var(--bg-light);border-radius:6px">
      ${weekSub}
    </div>

    ${todayActiveCount > 0 ? `<div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">📌 今日课程提醒</div>
          <div class="card-subtitle">今天是${days[currentDayIndex]}${wi ? '·' + wi.label : ''} · 共${todayActiveCount}节课</div>
        </div>
      </div>
      <div>
        ${todayCourses.map(c => `<div class="today-course-item">
          <span class="tc-time">${timeSlots[c.slot]?.time || ''}</span>
          <span class="tc-name">${c.course}</span>
          <span class="tc-loc">${c.location || ''}</span>
          ${c.weekType && c.weekType !== 'all' ? `<span class="week-badge ${c.weekType}">${c.weekType === 'odd' ? '单周' : '双周'}</span>` : ''}
        </div>`).join('')}
      </div>
    </div>` : `<div class="card">
      <div class="card-header"><div class="card-title">📌 今日课程提醒</div></div>
      <div class="empty-state" style="padding:30px">
        <div class="empty-icon" style="font-size:32px">🎉</div>
        <div class="empty-text">今天是${days[currentDayIndex]}${wi ? '·' + wi.label : ''}，无课</div>
      </div>
    </div>`}

    <div class="card">
      <div class="card-header">
        <div class="card-title">校历</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline btn-sm" onclick="importCalendarImage()">📅 选择图片</button>
          <button class="btn btn-outline btn-sm" onclick="setSemesterStart()">🗓️ 学期设置</button>
        </div>
      </div>
      ${scheduleImage
        ? `<div class="calendar-image-container"><img src="${scheduleImage}" alt="校历" style="cursor:pointer" onclick="importCalendarImage()"></div>
           <p style="text-align:center;font-size:12px;color:var(--text-muted);margin-top:8px">点击图片可替换 · 也可拖拽新图片到下方区域</p>`
        : `<div class="drop-zone" id="calendarDropZone" onclick="importCalendarImage()"
             ondragover="handleCalendarDragOver(event)" ondragleave="handleCalendarDragLeave(event)" ondrop="handleCalendarDrop(event)">
             <div class="drop-icon">📅</div>
             <div class="drop-text">拖拽校历图片到此处，或点击选择文件</div>
             <div class="drop-hint">支持 JPG / PNG / JPEG / GIF / BMP 格式</div>
           </div>`
      }
      ${scheduleImage ? `<div class="drop-zone" id="calendarDropZone2" style="padding:20px 16px"
           ondragover="handleCalendarDragOver(event)" ondragleave="handleCalendarDragLeave(event)" ondrop="handleCalendarDrop(event)">
           <div class="drop-text" style="margin:0">📁 拖拽新图片到此处可替换校历</div>
         </div>` : ''}
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">个人课表</div>
          <div class="card-subtitle">${wi ? `本周为${wi.label}，单双周课程已智能过滤` : '共' + schedule.length + '门课程'}</div>
        </div>
        <button class="btn btn-outline btn-sm" onclick="editSchedule()">✏️ 编辑课表</button>
      </div>
      ${schedule.length > 0
        ? `<div class="table-wrapper" style="overflow-x:auto">
            <div class="schedule-grid">
              <div class="schedule-cell header">时段</div>
              ${days.map((d, di) => `<div class="schedule-cell header"${di === currentDayIndex ? ' style="background:#2E6EBE"' : ''}>${d}${di === currentDayIndex ? '<br><span style="font-size:9px">今天</span>' : ''}</div>`).join('')}
              ${timeSlots.map((ts, i) => {
                let row = '<div class="schedule-cell time">' + ts.period + '<br><span style="font-size:10px;font-weight:400">' + ts.time + '</span></div>';
                for (let di = 0; di < 7; di++) {
                  const courses = schedule.filter(s => s.day === di && s.slot === i);
                  if (courses.length === 0) {
                    row += '<div class="schedule-cell"></div>';
                  } else {
                    let cellContent = courses.map(c => {
                      const active = isCourseThisWeek(c, wi);
                      const badge = c.weekType && c.weekType !== 'all' ? '<span class="week-badge ' + c.weekType + '">' + (c.weekType === 'odd' ? '单' : '双') + '</span>' : '';
                      return '<div class="' + (active ? '' : 'dimmed') + '">' + c.course + (c.location ? '<br>' + c.location : '') + badge + '</div>';
                    }).join('<hr style="margin:2px;border:none;border-top:1px solid var(--border-color)">');
                    row += '<div class="schedule-cell has-class">' + cellContent + '</div>';
                  }
                }
                return row;
              }).join('')}
            </div>
          </div>`
        : `<div class="empty-state"><div class="empty-icon">📚</div><div class="empty-text">点击「编辑课表」录入个人学期课表</div></div>`
      }
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">已导入文件管理</div>
      </div>
      <div class="file-mgr-item">
        <div class="file-mgr-thumb">${scheduleImage ? `<img src="${scheduleImage}" alt="校历">` : '📅'}</div>
        <div class="file-mgr-info">
          <div class="file-mgr-name">校历图片</div>
          <div class="file-mgr-meta">${scheduleImage ? '已导入 · 点击右侧可替换或删除' : '未导入'}</div>
        </div>
        <div style="display:flex;gap:8px">
          ${scheduleImage ? `<button class="btn btn-sm btn-outline" onclick="importCalendarImage()">替换</button><button class="btn btn-sm btn-danger" onclick="deleteCalendarImage()">删除</button>` : `<button class="btn btn-sm btn-outline" onclick="importCalendarImage()">导入</button>`}
        </div>
      </div>
      <div class="file-mgr-item">
        <div class="file-mgr-thumb">📚</div>
        <div class="file-mgr-info">
          <div class="file-mgr-name">个人课表</div>
          <div class="file-mgr-meta">${schedule.length > 0 ? `已录入 · ${schedule.length} 门课程` : '未录入'}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-outline" onclick="editSchedule()">${schedule.length > 0 ? '编辑' : '录入'}</button>
          ${schedule.length > 0 ? `<button class="btn btn-sm btn-danger" onclick="clearSchedule()">清空</button>` : ''}
        </div>
      </div>
      <div class="file-mgr-item">
        <div class="file-mgr-thumb">🗓️</div>
        <div class="file-mgr-info">
          <div class="file-mgr-name">学期信息</div>
          <div class="file-mgr-meta">${semesterStart ? `开始日 ${semesterStart} · ${totalWeeks}周` : '未设置'}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-outline" onclick="setSemesterStart()">${semesterStart ? '修改' : '设置'}</button>
          ${semesterStart ? `<button class="btn btn-sm btn-danger" onclick="clearSemesterStart()">删除</button>` : ''}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">考勤打卡提醒</div>
      </div>
      <div class="reminder-banner" style="margin:0">
        <span class="reminder-icon">⏰</span>
        <span>工作日 8:40 自动提醒打卡（浏览器需保持工作台打开状态）</span>
      </div>
    </div>
  `;
};

function importCalendarImage() {
  const fileInput = document.getElementById('fileInput');
  const originalAccept = fileInput.accept;
  fileInput.accept = 'image/jpeg,image/png,image/gif,image/bmp,.jpg,.jpeg,.png,.gif,.bmp';
  state.fileImportCallback = async (file) => {
    fileInput.accept = originalAccept;
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件（JPG/PNG等）', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      await setSetting('calendarImage', e.target.result);
      showToast('校历图片已上传', 'success');
      navigateTo('calendar');
    };
    reader.readAsDataURL(file);
  };
  fileInput.click();
}

// 拖拽上传校历图片
function handleCalendarDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  const zone = event.currentTarget;
  zone.classList.add('drag-over');
}

function handleCalendarDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  const zone = event.currentTarget;
  zone.classList.remove('drag-over');
}

async function handleCalendarDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const zone = event.currentTarget;
  zone.classList.remove('drag-over');
  const files = event.dataTransfer.files;
  if (files.length === 0) return;
  const file = files[0];
  if (!file.type.startsWith('image/')) {
    showToast('请拖入图片文件（JPG/PNG等）', 'error');
    return;
  }
  showLoading('正在导入校历图片...');
  const reader = new FileReader();
  reader.onload = async (e) => {
    await setSetting('calendarImage', e.target.result);
    hideLoading();
    showToast('校历图片已上传', 'success');
    navigateTo('calendar');
  };
  reader.onerror = () => {
    hideLoading();
    showToast('图片读取失败', 'error');
  };
  reader.readAsDataURL(file);
}

// 删除校历图片
async function deleteCalendarImage() {
  if (!confirm('确认删除校历图片？删除后需要重新导入。')) return;
  await deleteSetting('calendarImage');
  showToast('校历图片已删除', 'success');
  navigateTo('calendar');
}

// 清空个人课表
async function clearSchedule() {
  if (!confirm('确认清空个人课表？此操作不可撤销。')) return;
  await deleteSetting('schedule');
  showToast('个人课表已清空', 'success');
  navigateTo('calendar');
}

// 删除学期开始日期
async function clearSemesterStart() {
  if (!confirm('确认删除学期开始日期？删除后教学周将无法计算。')) return;
  await deleteSetting('semesterStart');
  showToast('学期开始日期已删除', 'success');
  navigateTo('calendar');
}

async function setSemesterStart() {
  const current = await getSetting('semesterStart', '');
  const totalWeeks = await getSetting('totalWeeks', 20);
  const today = new Date().toISOString().split('T')[0];
  const defaultDate = current || today;

  showModal('学期设置', `
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
      设置学期开始日期和总教学周数后，系统将自动计算当前教学周次、单双周，并智能过滤课表。
    </p>
    <div class="form-row">
      <div class="input-group">
        <label class="input-label">本学期开始日期 *</label>
        <input type="date" class="input" id="f_semesterStart" value="${defaultDate}">
      </div>
      <div class="input-group">
        <label class="input-label">总教学周数</label>
        <input type="number" class="input" id="f_totalWeeks" value="${totalWeeks}" min="1" max="30" style="width:80px">
      </div>
    </div>
    <div style="background:var(--bg-light);padding:12px;border-radius:8px;font-size:13px;color:var(--text-secondary);margin-top:12px" id="weekPreviewBox">
      设置日期后将显示当前教学周信息
    </div>
  `, `<button class="btn btn-outline" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveSemesterStart()">保存</button>`);

  // 实时预览
  const dateInput = document.getElementById('f_semesterStart');
  const weeksInput = document.getElementById('f_totalWeeks');
  const updatePreview = () => {
    const start = new Date(dateInput.value);
    const now = new Date();
    const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    const week = Math.floor(diffDays / 7) + 1;
    const tw = parseInt(weeksInput.value) || 20;
    const isOdd = week % 2 === 1;
    const box = document.getElementById('weekPreviewBox');
    if (!dateInput.value) { box.textContent = '请选择日期'; return; }
    if (week < 1) {
      box.innerHTML = `距学期开始还有 <span style="color:var(--primary);font-weight:600">${Math.abs(week - 1)}周</span>（学期未开始）`;
    } else if (week > tw) {
      box.innerHTML = `当前为第 <span style="color:var(--warning);font-weight:600">${week}周</span>，已超过设定的${tw}周（学期已结束）`;
    } else {
      box.innerHTML = `当前为第 <span style="color:var(--primary);font-weight:600">${week}周</span> · <span style="color:${isOdd ? 'var(--primary)' : 'var(--success)'};font-weight:600">${isOdd ? '单周' : '双周'}</span>（共${tw}周）`;
    }
  };
  dateInput.addEventListener('change', updatePreview);
  weeksInput.addEventListener('input', updatePreview);
  updatePreview();
}

async function saveSemesterStart() {
  const start = document.getElementById('f_semesterStart').value;
  const weeks = parseInt(document.getElementById('f_totalWeeks').value) || 20;
  if (!start) { showToast('请选择学期开始日期', 'error'); return; }
  await setSetting('semesterStart', start);
  await setSetting('totalWeeks', weeks);
  closeModal();
  showToast(`学期已设置：开始日 ${start}，共 ${weeks} 周`, 'success');
  navigateTo('calendar');
}

const SCHED_TIME_SLOTS = [
  { period: '第1-2节', time: '08:00-09:35' }, { period: '第3-4节', time: '09:50-11:25' },
  { period: '第5-6节', time: '11:40-13:15' }, { period: '第7-8节', time: '14:00-15:35' },
  { period: '第9-10节', time: '15:50-17:25' }, { period: '第11-12节', time: '19:00-20:35' }
];
const SCHED_DAYS = ['周一','周二','周三','周四','周五','周六','周日'];
const SCHED_WEEK_TYPES = [
  { value: 'all', label: '每周' },
  { value: 'odd', label: '单周' },
  { value: 'even', label: '双周' }
];

async function editSchedule() {
  const existing = await getSetting('schedule', []);
  const rows = existing.length > 0 ? existing : [{ day: 0, slot: 0, course: '', location: '', weekType: 'all' }];

  showModal('编辑个人课表', `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <span style="font-size:13px;color:var(--text-muted)">每行一门课：</span>
      <span class="week-badge odd" style="font-size:10px">单周</span><span style="font-size:12px;color:var(--text-muted)">=第1,3,5…周上课</span>
      <span class="week-badge even" style="font-size:10px">双周</span><span style="font-size:12px;color:var(--text-muted)">=第2,4,6…周上课</span>
    </div>
    <div id="scheduleList" style="max-height:400px;overflow-y:auto">
      ${rows.map((s, idx) => renderScheduleRow(s, idx)).join('')}
    </div>
    <button class="btn btn-outline" style="margin-top:8px;width:100%" onclick="addScheduleRow()">＋ 添加一门课程</button>
  `, `<button class="btn btn-outline" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveSchedule()">保存课表</button>`);
}

function renderScheduleRow(s, idx) {
  return `<div class="sched-edit-row" data-index="${idx}">
    <select class="select sched-day" style="font-size:12px">
      ${SCHED_DAYS.map((d, di) => `<option value="${di}" ${s.day === di ? 'selected' : ''}>${d}</option>`).join('')}
    </select>
    <select class="select sched-slot" style="font-size:12px">
      ${SCHED_TIME_SLOTS.map((ts, ti) => `<option value="${ti}" ${s.slot === ti ? 'selected' : ''}>${ts.period}</option>`).join('')}
    </select>
    <input type="text" class="input sched-course" value="${s.course || ''}" placeholder="课程名称" style="font-size:13px">
    <input type="text" class="input sched-loc" value="${s.location || ''}" placeholder="教室" style="font-size:13px">
    <select class="select sched-wt" style="font-size:12px">
      ${SCHED_WEEK_TYPES.map(wt => `<option value="${wt.value}" ${s.weekType === wt.value || (!s.weekType && wt.value === 'all') ? 'selected' : ''}>${wt.label}</option>`).join('')}
    </select>
    <button class="btn btn-sm btn-danger" onclick="removeScheduleRow(${idx})" style="padding:4px 8px">✕</button>
  </div>`;
}

function addScheduleRow() {
  const list = document.getElementById('scheduleList');
  const idx = list.children.length;
  list.insertAdjacentHTML('beforeend', renderScheduleRow({ day: 0, slot: 0, course: '', location: '', weekType: 'all' }, idx));
}

function removeScheduleRow(idx) {
  const list = document.getElementById('scheduleList');
  const row = list.querySelector(`[data-index="${idx}"]`);
  if (row) row.remove();
  if (list.children.length === 0) addScheduleRow();
}

async function saveSchedule() {
  const rows = document.querySelectorAll('#scheduleList .sched-edit-row');
  const schedule = [];
  rows.forEach(row => {
    const course = row.querySelector('.sched-course').value.trim();
    if (!course) return;
    schedule.push({
      day: parseInt(row.querySelector('.sched-day').value),
      slot: parseInt(row.querySelector('.sched-slot').value),
      course,
      location: row.querySelector('.sched-loc').value.trim(),
      weekType: row.querySelector('.sched-wt').value
    });
  });
  await setSetting('schedule', schedule);
  closeModal();
  showToast(`课表已保存（${schedule.length}门课程）`, 'success');
  navigateTo('calendar');
}

// ---------- 资讯推送 ----------
const NEWS_SOURCES = [
  { category: '思政教育', title: '教育部思想政治工作司', url: 'http://www.moe.gov.cn/s78/A12/', source: '教育部' },
  { category: '思政教育', title: '中国大学生在线', url: 'https://www.univs.cn/', source: '教育部' },
  { category: '思政教育', title: '学习强国', url: 'https://www.xuexi.cn/', source: '中宣部' },
  { category: '学生管理', title: '教育部学生服务与素质发展中心', url: 'http://www.moe.gov.cn/s78/', source: '教育部' },
  { category: '学生管理', title: '全国高校辅导员工作网站', url: 'https://www.gfdx.fudan.edu.cn/', source: '高校思政网' },
  { category: '党建工作', title: '共产党员网', url: 'https://www.12371.cn/', source: '中组部' },
  { category: '党建工作', title: '高校党建在线', url: 'http://www.moe.gov.cn/jyb_sjzl/', source: '教育部' },
  { category: '就业指导', title: '国家大学生就业服务平台', url: 'https://www.ncss.cn/', source: '教育部' },
  { category: '就业指导', title: '中国大学生就业', url: 'https://www.univs.cn/', source: '高校思政网' },
  { category: '政策新规', title: '教育部政策法规', url: 'http://www.moe.gov.cn/s78/A02/', source: '教育部' },
  { category: '政策新规', title: '陕西省教育厅', url: 'http://jyt.shaanxi.gov.cn/', source: '省教育厅' },
  { category: '能力提升', title: '高校辅导员网络学院', url: 'https://www.usors.cn/', source: '教育部' },
  { category: '能力提升', title: '中国高等教育学会辅导员工作研究分会', url: 'https://www.gfdx.fudan.edu.cn/', source: '学工分会' }
];

MODULE_RENDERERS.news = function(container) {
  const categories = ['思政教育','学生管理','党建工作','就业指导','政策新规','能力提升'];
  let html = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">辅导员资讯推送</div>
          <div class="card-subtitle">仅收录教育部、省教育厅、学习强国等官方渠道资讯</div>
        </div>
      </div>
      <div class="tabs" id="newsTabs">
        ${categories.map((cat, i) => `<button class="tab ${i===0?'active':''}" onclick="switchNewsTab('${cat}', this)">${cat}</button>`).join('')}
      </div>
      <div id="newsContent"></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">资讯来源说明</div>
      </div>
      <p style="font-size:13px;color:var(--text-muted);line-height:1.8">
        本模块仅收录官方正规渠道发布的资讯，包括：<br>
        1. 中华人民共和国教育部 (moe.gov.cn)<br>
        2. 陕西省教育厅 (jyt.shaanxi.gov.cn)<br>
        3. 学习强国 (xuexi.cn)<br>
        4. 全国高校思政网 (univs.cn)<br>
        5. 共产党员网 (12371.cn)<br>
        6. 国家大学生就业服务平台 (ncss.cn)<br>
        <br>
        点击下方各板块链接可直接跳转至官方来源页面查看最新资讯。
      </p>
    </div>
  `;
  container.innerHTML = html;
  switchNewsTab('思政教育', document.querySelector('#newsTabs .tab'));
};

function switchNewsTab(category, btn) {
  document.querySelectorAll('#newsTabs .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  const sources = NEWS_SOURCES.filter(s => s.category === category);
  const content = document.getElementById('newsContent');
  content.innerHTML = sources.map(s => `
    <div class="news-item">
      <span class="news-tag tag-blue">${s.source}</span>
      <div class="news-content">
        <a href="${s.url}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">
          <div class="news-title">${s.title}</div>
        </a>
        <div class="news-meta">点击查看最新资讯 →</div>
      </div>
    </div>
  `).join('');
}

// ---------- 系统设置 ----------
MODULE_RENDERERS.settings = async function(container) {
  const studentCount = await dbCount('students');
  const gradeCount = await dbCount('grades');
  const assessmentCount = await dbCount('assessments');

  const cloudReady = isSupabaseReady();
  const syncStatus = cloudReady
    ? (syncState.syncing ? '同步中...' : syncState.lastSync ? '已同步 ' + new Date(syncState.lastSync).toLocaleString('zh-CN') : '未同步')
    : '未配置云端';
  const userEmail = syncState.userEmail || '未登录';

  let cloudCard = '';
  if (cloudReady) {
    cloudCard = `
    <div class="card">
      <div class="card-header"><div class="card-title">云端同步</div></div>
      <div style="font-size:13px;color:var(--text-body);line-height:2;margin-bottom:16px">
        <p>📧 登录邮箱：<strong>${userEmail}</strong></p>
        <p>☁️ 同步状态：<strong>${syncStatus}</strong></p>
        <p>🔄 修改数据后自动同步到云端，换设备登录即可恢复</p>
      </div>
      <button class="btn btn-primary" onclick="manualSync()">立即同步</button>
    </div>`;
  }

  let passwordCard;
  if (cloudReady) {
    passwordCard = `
    <div class="card">
      <div class="card-header"><div class="card-title">修改登录密码</div></div>
      <div style="max-width:400px">
        <div class="input-group" style="margin-bottom:12px">
          <label class="input-label">新密码</label>
          <input type="password" class="input" id="newPassword" placeholder="至少6位">
        </div>
        <div class="input-group" style="margin-bottom:12px">
          <label class="input-label">确认新密码</label>
          <input type="password" class="input" id="newPassword2" placeholder="再次输入新密码">
        </div>
        <button class="btn btn-primary" onclick="changePassword()">修改密码</button>
      </div>
    </div>`;
  } else {
    passwordCard = `
    <div class="card">
      <div class="card-header"><div class="card-title">修改登录密码</div></div>
      <div style="max-width:400px">
        <div class="input-group" style="margin-bottom:12px">
          <label class="input-label">当前密码</label>
          <input type="password" class="input" id="oldPassword" placeholder="请输入当前密码">
        </div>
        <div class="input-group" style="margin-bottom:12px">
          <label class="input-label">新密码</label>
          <input type="password" class="input" id="newPassword" placeholder="至少6位">
        </div>
        <div class="input-group" style="margin-bottom:12px">
          <label class="input-label">确认新密码</label>
          <input type="password" class="input" id="newPassword2" placeholder="再次输入新密码">
        </div>
        <button class="btn btn-primary" onclick="changePassword()">修改密码</button>
      </div>
    </div>`;
  }

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><div class="card-title">数据概览</div></div>
      <div class="stat-grid">
        <div class="stat-card stat-blue"><div class="stat-value">${studentCount}</div><div class="stat-label">学生记录</div></div>
        <div class="stat-card stat-green"><div class="stat-value">${gradeCount}</div><div class="stat-label">成绩记录</div></div>
        <div class="stat-card stat-orange"><div class="stat-value">${assessmentCount}</div><div class="stat-label">综测记录</div></div>
      </div>
    </div>

    ${cloudCard}

    ${passwordCard}

    <div class="card">
      <div class="card-header"><div class="card-title">数据备份与恢复</div></div>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
        ${cloudReady ? '云端已开启自动同步。此外也可手动导出备份文件存到网盘作为双重保险。' : '导出数据为备份文件，可保存到百度网盘等云盘。换设备时导入备份文件即可恢复全部数据。'}
      </p>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="backupData()">导出数据备份</button>
        <button class="btn btn-outline" onclick="restoreData()">导入数据恢复</button>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-title">隐私与安全</div></div>
      <div style="font-size:13px;color:var(--text-body);line-height:2">
        ${cloudReady ? '<p>🔒 邮箱登录，密码由 Supabase 托管，安全可靠</p>' : ''}
        ${cloudReady ? '<p>🔒 云端数据受行级安全策略保护，仅本人可访问</p>' : ''}
        <p>🔒 姓名自动脱敏显示，联系方式仅显示前3后4位</p>
        <p>🔒 本地数据存储在 IndexedDB，离线可用</p>
        <p>⚠️ 清除浏览器缓存会导致本地数据丢失，云端有备份可恢复</p>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-title">使用说明</div></div>
      <div style="font-size:13px;color:var(--text-body);line-height:2">
        ${cloudReady ? '<p><strong>登录：</strong>邮箱+密码登录，数据自动同步到云端</p>' : '<p><strong>首次使用：</strong>设置密码后进入工作台</p>'}
        <p><strong>导入学生：</strong>点击「学生管理」→「导入Excel」，上传包含学号、姓名等信息的Excel表</p>
        <p><strong>导入成绩：</strong>点击「学业成绩」→「导入成绩排名」，上传已算好的排名表（建议含：学号、姓名、班级、学期、加权总分、总排名），系统自动记录并支持趋势/对比分析</p>
        <p><strong>导入综测：</strong>点击「综测管理」→「导入综测Excel」，Excel需包含学号和综测总分，系统自动计算排名</p>
        ${cloudReady ? '<p><strong>换设备：</strong>新设备打开网址→邮箱登录→数据自动恢复</p>' : '<p><strong>换设备：</strong>导出备份→网盘→新设备导入恢复</p>'}
      </div>
    </div>
  `;
};

async function changePassword() {
  const newPw = document.getElementById('newPassword').value;
  const newPw2 = document.getElementById('newPassword2').value;

  if (newPw.length < 6) { showToast('新密码至少6位', 'error'); return; }
  if (newPw !== newPw2) { showToast('两次新密码不一致', 'error'); return; }

  if (isSupabaseReady()) {
    try {
      await supabaseChangePassword(newPw);
      showToast('密码修改成功', 'success');
      document.getElementById('newPassword').value = '';
      document.getElementById('newPassword2').value = '';
    } catch (e) {
      showToast(e.message || '密码修改失败', 'error');
    }
  } else {
    const oldPw = document.getElementById('oldPassword').value;
    const storedHash = await getSetting('password');
    if (simpleHash(oldPw) !== storedHash) { showToast('当前密码错误', 'error'); return; }
    await setSetting('password', simpleHash(newPw));
    showToast('密码修改成功', 'success');
    document.getElementById('oldPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('newPassword2').value = '';
  }
}

async function backupData() {
  showLoading('正在生成备份文件...');
  const data = await exportAllData();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `辅导员工作台备份_${formatDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
  hideLoading();
  showToast('备份文件已下载，建议保存到百度网盘', 'success');
}

function restoreData() {
  state.fileImportCallback = async (file) => {
    if (!confirm('导入数据将覆盖当前所有数据，确定继续吗？')) return;
    showLoading('正在恢复数据...');
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importAllData(data);
      hideLoading();
      showToast('数据恢复成功', 'success');
      state.students = await dbGetAll('students');
      navigateTo('settings');
    } catch (err) {
      hideLoading();
      showToast('恢复失败：文件格式错误', 'error');
    }
  };
  const input = document.getElementById('fileInput');
  input.accept = '.json';
  input.click();
  setTimeout(() => { input.accept = '.xlsx,.xls,.csv'; }, 1000);
}

// ========== 启动 ==========
init();
