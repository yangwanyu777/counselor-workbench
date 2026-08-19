/* ============================================
   Supabase 云端同步层
   邮箱登录 + 跨设备数据同步
   ============================================ */

let supabaseClient = null;
let syncTimer = null;
const syncState = {
  lastSync: null,
  syncing: false,
  enabled: false,
  userEmail: null
};

// 初始化 Supabase 客户端
function initSupabase() {
  if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) {
    console.log('[Sync] Supabase 未配置，使用纯本地模式');
    return false;
  }
  try {
    supabaseClient = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    syncState.enabled = true;
    console.log('[Sync] Supabase 初始化成功');
    return true;
  } catch (e) {
    console.error('[Sync] Supabase 初始化失败:', e);
    return false;
  }
}

function isSupabaseReady() {
  return syncState.enabled && supabaseClient !== null;
}

// 注册新账号
async function supabaseSignUp(email, password) {
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) throw error;
  syncState.userEmail = email;
  return data;
}

// 带超时的 Promise（云端请求可能很慢，避免无限等待卡死界面）
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error((label || '请求') + '超时，云端响应过慢')), ms))
  ]);
}

// 邮箱密码登录
async function supabaseSignIn(email, password) {
  const { data, error } = await withTimeout(
    supabaseClient.auth.signInWithPassword({ email, password }),
    12000,
    '登录请求'
  );
  if (error) throw error;
  syncState.userEmail = email;
  return data;
}

// 退出登录
async function supabaseSignOut() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.auth.signOut();
  if (error) throw error;
  syncState.userEmail = null;
  syncState.lastSync = null;
}

// 获取当前登录用户（从 localStorage 读取 session，不依赖网络）
async function getCurrentUser() {
  if (!supabaseClient) return null;
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;
  syncState.userEmail = session.user?.email || null;
  return session.user;
}

// 修改密码（通过 Supabase）
async function supabaseChangePassword(newPassword) {
  const { data, error } = await supabaseClient.auth.updateUser({ password: newPassword });
  if (error) throw error;
  return data;
}

// 推送本地数据到云端
async function pushToCloud() {
  if (!isSupabaseReady()) return false;
  const user = await getCurrentUser();
  if (!user) return false;

  syncState.syncing = true;
  updateSyncIndicator();

  try {
    const localData = await exportAllData();
    const { error } = await supabaseClient
      .from('workbench_data')
      .upsert({
        user_id: user.id,
        data: localData,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (error) throw error;
    syncState.lastSync = new Date();
    console.log('[Sync] 数据已上传到云端');
    updateSyncIndicator();
    return true;
  } catch (e) {
    console.error('[Sync] 上传失败:', e.message);
    updateSyncIndicator();
    return false;
  } finally {
    syncState.syncing = false;
    updateSyncIndicator();
  }
}

// 从云端拉取数据到本地
async function pullFromCloud() {
  if (!isSupabaseReady()) return null;
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabaseClient
    .from('workbench_data')
    .select('data, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) throw error;
  if (data && data.data) {
    await importAllData(data.data);
    syncState.lastSync = new Date(data.updated_at);
    console.log('[Sync] 数据已从云端拉取');
    return data;
  }
  return null;
}

// 智能同步（登录后自动调用）
async function smartSync() {
  if (!isSupabaseReady()) return 'disabled';
  const user = await getCurrentUser();
  if (!user) return 'nouser';

  // 检查本地是否有数据
  const localStudentCount = await dbCount('students');
  const localSettings = await dbGetAll('settings');
  const hasLocalData = localStudentCount > 0 || localSettings.length > 0;

  // 检查云端是否有数据
  const { data: cloudData, error } = await withTimeout(
    supabaseClient
      .from('workbench_data')
      .select('data, updated_at')
      .eq('user_id', user.id)
      .maybeSingle(),
    12000,
    '云端查询'
  );

  if (error && error.code !== 'PGRST116') {
    console.error('[Sync] 查询云端数据失败:', error);
    return 'error';
  }

  const hasCloudData = cloudData && cloudData.data && (
    (cloudData.data.students && cloudData.data.students.length > 0) ||
    (cloudData.data.settings && cloudData.data.settings.length > 0)
  );

  if (hasCloudData && !hasLocalData) {
    // 云端有，本地没有 → 拉取
    await pullFromCloud();
    return 'pulled';
  } else if (!hasCloudData && hasLocalData) {
    // 本地有，云端没有 → 推送
    await pushToCloud();
    return 'pushed';
  } else if (hasCloudData && hasLocalData) {
    // 两边都有 → 以云端为准（先拉取，再推送本地增量）
    await pullFromCloud();
    // 拉取后如果有本地新数据，再推送
    setTimeout(() => pushToCloud(), 500);
    return 'synced';
  }
  return 'empty';
}

// 自动同步（防抖 3 秒）
function scheduleAutoSync() {
  if (!isSupabaseReady()) return;
  if (!syncState.userEmail) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    pushToCloud();
  }, 3000);
}

// 更新顶部栏同步指示器
function updateSyncIndicator() {
  const el = document.getElementById('syncIndicator');
  if (!el) return;

  if (!isSupabaseReady()) {
    el.style.display = 'none';
    return;
  }

  el.style.display = 'inline-flex';
  if (syncState.syncing) {
    el.className = 'sync-indicator syncing';
    el.innerHTML = '<span class="sync-dot syncing"></span>同步中';
  } else if (syncState.lastSync) {
    el.className = 'sync-indicator synced';
    el.innerHTML = '<span class="sync-dot synced"></span>已同步';
  } else {
    el.className = 'sync-indicator';
    el.innerHTML = '<span class="sync-dot"></span>未同步';
  }
}

// 手动触发同步
async function manualSync() {
  if (!isSupabaseReady()) {
    showToast('未配置云端同步', 'error');
    return;
  }
  showToast('正在同步数据...', 'info');
  const ok = await pushToCloud();
  if (ok) {
    showToast('数据同步成功', 'success');
  } else {
    showToast('同步失败，请检查网络', 'error');
  }
}

// 监听数据变更事件，触发自动同步
window.addEventListener('dataChanged', () => {
  scheduleAutoSync();
});
