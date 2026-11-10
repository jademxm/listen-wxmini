#!/usr/bin/env node
/**
 * 品牌配置同步：把 config/brand.js 写进那些读不到 JS 的静态文件。
 *
 * 用法：node miniprogram/scripts/sync-brand.js
 *
 * 为什么需要它：app.json / 页面 json / WXSS 都不能 require JS，
 * tabBar 文案、导航栏标题、主题色只能落成字面量。脚本负责从品牌配置生成这些字面量，
 * 保持「换项目只改 config/brand.js」这一条规则不变。
 *
 * 幂等：重复执行不会有任何变化。只覆盖品牌相关字段，其余配置原样保留。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { brand } = require(path.join(__dirname, '..', 'config', 'brand'));

const ROOT = path.join(__dirname, '..');

/** 各页 navigationBarTitleText 的取值；首页固定用站名 */
const PAGE_TITLES = {
  'pages/index/index': brand.name,
  'pages/album/album': brand.titles.album,
  'pages/player/player': brand.titles.player,
  'pages/history/history': brand.titles.history,
  'pages/mine/mine': brand.titles.mine,
};

/** 色板 → WXSS 变量名，顺序固定以保证生成结果稳定 */
const COLOR_VARS = [
  ['primary', '--brand-primary'],
  ['onPrimary', '--brand-on-primary'],
  ['primarySoft', '--brand-primary-soft'],
  ['pageBg', '--brand-page-bg'],
  ['navBg', '--brand-nav-bg'],
  ['tabBg', '--brand-tab-bg'],
  ['tabText', '--brand-tab-text'],
  ['tabTextActive', '--brand-tab-text-active'],
];

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function writeFile(rel, content) {
  const target = path.join(ROOT, rel);
  let current = null;
  try { current = fs.readFileSync(target, 'utf8'); } catch (e) { current = null; }
  if (current === content) return false;
  fs.writeFileSync(target, content);
  return true;
}

function toJson(data) {
  return JSON.stringify(data, null, 2) + '\n';
}

/** 返回写入品牌字段后的 app.json（不落盘，供测试复用） */
function buildAppJson(source) {
  const app = JSON.parse(JSON.stringify(source));
  app.window = app.window || {};
  app.window.navigationBarTitleText = PAGE_TITLES['pages/index/index'];
  app.window.navigationBarBackgroundColor = brand.colors.navBg;
  app.window.backgroundColor = brand.colors.pageBg;

  app.tabBar = app.tabBar || {};
  app.tabBar.color = brand.colors.tabText;
  app.tabBar.selectedColor = brand.colors.tabTextActive;
  app.tabBar.backgroundColor = brand.colors.tabBg;
  (app.tabBar.list || []).forEach((item, index) => {
    if (brand.tabs[index]) item.text = brand.tabs[index];
  });
  return app;
}

/** config/brand.wxss 的完整内容 */
function buildWxss() {
  const lines = COLOR_VARS.map(([key, name]) => '  ' + name + ': ' + brand.colors[key] + ';');
  return [
    '/* 由 miniprogram/scripts/sync-brand.js 从 config/brand.js 生成，请勿手改。 */',
    '/* 改主色 / 界面底色只改 config/brand.js，再跑一次同步脚本。 */',
    'page {',
  ].concat(lines).concat(['}', '']).join('\n');
}

function buildDescription() {
  return brand.name + '小程序：' + brand.description;
}

function run() {
  const changed = [];

  // 1) app.json：全局标题 / 窗口配色 / tabBar 文案与配色
  const app = buildAppJson(readJson('app.json'));
  if (writeFile('app.json', toJson(app))) changed.push('app.json');

  // 2) 各页 navigationBarTitleText
  Object.keys(PAGE_TITLES).forEach((page) => {
    const rel = page + '.json';
    const json = readJson(rel);
    if (json.navigationBarTitleText === PAGE_TITLES[page]) return;
    json.navigationBarTitleText = PAGE_TITLES[page];
    if (writeFile(rel, toJson(json))) changed.push(rel);
  });

  // 3) project.config.json 的 description
  const project = readJson('project.config.json');
  const description = buildDescription();
  if (project.description !== description) {
    project.description = description;
    if (writeFile('project.config.json', toJson(project))) changed.push('project.config.json');
  }

  // 4) 主题色变量
  if (writeFile('config/brand.wxss', buildWxss())) changed.push('config/brand.wxss');

  if (!changed.length) {
    console.log('品牌配置已是最新：' + brand.name);
    return changed;
  }
  console.log('品牌配置已同步：' + brand.name);
  changed.forEach((rel) => console.log('  · ' + rel));
  return changed;
}

if (require.main === module) run();

module.exports = { buildAppJson, buildWxss, buildDescription, PAGE_TITLES, COLOR_VARS, run };
