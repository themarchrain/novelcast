import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import './index.css';

/** MiniMax 设计语言：白画布 + 近黑墨 + 黑药丸按钮；品牌彩色只留给身份时刻 */
const miniMaxTheme = {
  colorPrimary: '#0a0a0a',
  // 近黑主色会让 antd 自动派生出色板"浅色层"变深灰（如选中项背景 #3d3d3d），
  // 因此凡依赖派生浅色的场景必须显式覆盖：别名 token 层（controlItemBg*）
  // 管住所有"选中+悬停"组合态，components 层再对各组件显式设值兜底。
  colorPrimaryHover: '#262626',
  colorPrimaryActive: '#000000',
  controlItemBgActive: '#f7f8fa',
  controlItemBgActiveHover: '#eef0f3',
  colorInfo: '#1d4ed8',
  colorLink: '#1d4ed8',
  colorError: '#d45656',
  colorSuccess: '#147a52',
  colorWarning: '#b45309',
  colorBgBase: '#ffffff',
  colorBgLayout: '#ffffff',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorBorder: '#e5e7eb',
  colorBorderSecondary: '#eaecf0',
  colorText: '#0a0a0a',
  colorTextSecondary: '#45515e',
  colorTextTertiary: '#5f5f5f',
  colorTextQuaternary: '#8e8e93',
  borderRadius: 8,
  fontFamily:
    "'DM Sans', Inter, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif",
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: miniMaxTheme,
        components: {
          Button: { borderRadius: 9999, controlHeight: 40, fontWeight: 600 },
          Input: {
            controlHeight: 40,
            // DESIGN.md: 激活态 2px 深蓝描边
            activeBorderColor: '#1d4ed8',
            hoverBorderColor: '#c6c9cf',
            activeShadow: '0 0 0 2px rgba(29, 78, 216, 0.12)',
          },
          Select: {
            controlHeight: 40,
            // 修复：近黑主色派生的选中项背景是深灰 #3d3d3d，深底配深字不可读
            optionSelectedBg: '#f7f8fa',
            optionActiveBg: '#f2f3f5',
            activeBorderColor: '#1d4ed8',
            hoverBorderColor: '#c6c9cf',
            activeOutlineColor: 'rgba(29, 78, 216, 0.12)',
          },
          Card: { borderRadiusLG: 16 },
          Modal: { borderRadiusLG: 16 },
          Progress: { defaultColor: '#0a0a0a' },
          Segmented: { itemSelectedBg: '#0a0a0a', itemSelectedColor: '#ffffff', trackBg: '#f7f8fa' },
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>,
);
