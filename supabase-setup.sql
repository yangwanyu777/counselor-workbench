-- ============================================
-- 辅导员工作台 - Supabase 数据库初始化脚本
-- ============================================
-- 使用方法：
-- 1. 登录 Supabase 控制台 (https://supabase.com)
-- 2. 进入你的项目 → SQL Editor
-- 3. 将本文件全部内容粘贴进去，点击 Run
-- ============================================

-- 1. 创建数据表
CREATE TABLE IF NOT EXISTS workbench_data (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  data JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- 2. 启用行级安全策略 (RLS)
-- 每个用户只能读写自己的数据
ALTER TABLE workbench_data ENABLE ROW LEVEL SECURITY;

-- 3. 删除旧策略（如果存在）
DROP POLICY IF EXISTS "users_select_own_data" ON workbench_data;
DROP POLICY IF EXISTS "users_insert_own_data" ON workbench_data;
DROP POLICY IF EXISTS "users_update_own_data" ON workbench_data;
DROP POLICY IF EXISTS "users_delete_own_data" ON workbench_data;

-- 4. 创建安全策略
-- 用户只能查询自己的数据
CREATE POLICY "users_select_own_data" ON workbench_data
  FOR SELECT USING (auth.uid() = user_id);

-- 用户只能插入自己的数据
CREATE POLICY "users_insert_own_data" ON workbench_data
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 用户只能更新自己的数据
CREATE POLICY "users_update_own_data" ON workbench_data
  FOR UPDATE USING (auth.uid() = user_id);

-- 用户只能删除自己的数据
CREATE POLICY "users_delete_own_data" ON workbench_data
  FOR DELETE USING (auth.uid() = user_id);

-- 5. 创建索引（提升查询性能）
CREATE INDEX IF NOT EXISTS idx_workbench_data_user_id ON workbench_data(user_id);

-- 6. 自动更新 updated_at 字段
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workbench_data_updated ON workbench_data;
CREATE TRIGGER trg_workbench_data_updated
  BEFORE UPDATE ON workbench_data
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 执行完毕！
-- 现在可以在工作台的 supabase-config.js 中
-- 填入项目 URL 和 anon key 开始使用
-- ============================================
