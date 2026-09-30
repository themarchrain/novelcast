import { Layout } from 'antd';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import DetailPage from './pages/DetailPage';
import SettingsPage from './pages/SettingsPage';

const { Content, Footer } = Layout;

export default function App() {
  const nav = useNavigate();
  const loc = useLocation();
  const onSettings = loc.pathname.startsWith('/settings');

  return (
    <Layout style={{ minHeight: '100vh', background: 'transparent' }}>
      <header className="topbar">
        <div className="brand" onClick={() => nav('/')}>
          <span className="brand-en">NovelCast</span>
          <span className="brand-zh">小说播客工坊</span>
        </div>
        <span className="topbar-time">AUDIO STUDIO</span>
        <nav className="topbar-nav">
          <span
            className={`topbar-link ${!onSettings ? 'active' : ''}`}
            onClick={() => nav('/')}
          >
            首页
          </span>
          <span
            className={`topbar-link ${onSettings ? 'active' : ''}`}
            onClick={() => nav('/settings')}
          >
            设置
          </span>
        </nav>
      </header>
      <Content>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/podcast/:id" element={<DetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Content>
      <Footer className="page-footer">
        <span className="mono">NOVELCAST</span> — 把小说章节变成一档可听的播客
      </Footer>
    </Layout>
  );
}
