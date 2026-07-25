import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft, Check, CheckCircle2, Clock3, Download, Eye, FileText,
  KeyRound, LoaderCircle, LogOut, Save, ShieldCheck, Trash2, X,
} from 'lucide-react';
import { formatBytes, type Material, type Submission, type SubmissionUpdate } from '@csd/shared';
import { apiUrl, requireApiUrl } from './lib/api';
import { extensionOf, formatOf, previewKind } from './lib/files';

const empty: Submission[] = [];

function PendingPreview({ submission, blob, onClose }: { submission: Submission; blob: Blob; onClose: () => void }) {
  const [text, setText] = useState('');
  const objectUrl = useMemo(() => URL.createObjectURL(blob), [blob]);
  const materialLike = {
    ...submission,
    downloadUrl: objectUrl,
    source: 'admin',
    path: `/${submission.course}/${submission.subject}/${submission.fileName}`,
  } as unknown as Material;
  const kind = previewKind(materialLike);

  useEffect(() => {
    if (kind === 'text') blob.text().then((value) => setText(value.slice(0, 500_000)));
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob, kind, objectUrl]);

  return <div className="preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="preview-modal moderation-preview" role="dialog" aria-modal="true">
      <header className="preview-header"><div><span>{formatOf(materialLike)} · {formatBytes(submission.size)}</span><h3>{submission.fileName}</h3></div><div className="preview-actions"><a href={objectUrl} download={submission.fileName}><Download /> Скачать</a><button onClick={onClose}><X /></button></div></header>
      <div className={`preview-stage ${kind}`}>
        {kind === 'image' && <img src={objectUrl} alt={submission.title} />}
        {kind === 'pdf' && <iframe src={objectUrl} title={submission.title} />}
        {kind === 'text' && <pre>{text || 'Загрузка текста…'}</pre>}
        {(kind === 'office' || kind === 'unsupported') && <div className="preview-message"><FileText /><h4>Файл готов к проверке</h4><p>Встроенный просмотр формата {extensionOf(submission.fileName).toUpperCase() || 'FILE'} недоступен. Скачайте его для проверки.</p><a href={objectUrl} download={submission.fileName}><Download /> Скачать файл</a></div>}
      </div>
      <footer className="preview-footer"><span>{submission.course}</span><i /><span>{submission.subject}</span><i /><span>{submission.submitter || 'Анонимно'}</span></footer>
    </section>
  </div>;
}

export function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem('csd-admin-token') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>(empty);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<Submission | null>(null);
  const [preview, setPreview] = useState<{ submission: Submission; blob: Blob } | null>(null);

  const logout = () => {
    sessionStorage.removeItem('csd-admin-token');
    setToken('');
    setSubmissions(empty);
    setDraft(null);
  };

  async function adminFetch(path: string, init: RequestInit = {}, authToken = token) {
    const response = await fetch(`${requireApiUrl()}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${authToken}` },
    });
    if (response.status === 401) {
      logout();
      throw new Error('Сессия истекла');
    }
    return response;
  }

  async function load(authToken = token) {
    if (!authToken) return;
    const response = await adminFetch('/api/submissions', {}, authToken);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось загрузить очередь');
    setSubmissions(result);
    const nextId = selectedId && result.some((item: Submission) => item.id === selectedId) ? selectedId : result[0]?.id || '';
    setSelectedId(nextId);
    setDraft(result.find((item: Submission) => item.id === nextId) || null);
  }

  useEffect(() => {
    if (!apiUrl) { setOnline(false); return; }
    fetch(`${apiUrl}/api/health`).then((response) => setOnline(response.ok)).catch(() => setOnline(false));
  }, []);

  useEffect(() => {
    if (token) load(token).catch((value) => setError(value instanceof Error ? value.message : 'Ошибка очереди'));
  }, [token]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const response = await fetch(`${requireApiUrl()}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Ошибка входа');
      sessionStorage.setItem('csd-admin-token', result.token);
      setToken(result.token);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Ошибка входа');
    } finally { setBusy(false); }
  }

  const choose = (submission: Submission) => {
    setSelectedId(submission.id);
    setDraft({ ...submission, tags: [...submission.tags] });
    setError(''); setNotice('');
  };

  const updateDraft = (value: SubmissionUpdate) => setDraft((current) => current ? ({ ...current, ...value }) : current);

  async function save(showNotice = true) {
    if (!draft) return undefined;
    const response = await adminFetch(`/api/submissions/${draft.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: draft.title, description: draft.description, course: draft.course,
        subject: draft.subject, kind: draft.kind, tags: draft.tags,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось сохранить изменения');
    setDraft(result);
    setSubmissions((items) => items.map((item) => item.id === result.id ? result : item));
    if (showNotice) setNotice('Изменения сохранены');
    return result as Submission;
  }

  async function act(action: 'approve' | 'reject') {
    if (!draft) return;
    if (action === 'reject' && !window.confirm(`Удалить заявку «${draft.title}» вместе с файлом?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (action === 'approve') {
        await save(false);
        const response = await adminFetch(`/api/submissions/${draft.id}/approve`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Не удалось опубликовать материал');
        setNotice(`«${result.title}» опубликован`);
      } else {
        const response = await adminFetch(`/api/submissions/${draft.id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Не удалось удалить заявку');
      }
      setSelectedId('');
      setDraft(null);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Ошибка модерации');
    } finally { setBusy(false); }
  }

  async function openPreview() {
    if (!draft) return;
    setBusy(true); setError('');
    try {
      const response = await adminFetch(`/api/submissions/${draft.id}/file`);
      if (!response.ok) throw new Error('Не удалось загрузить файл для просмотра');
      setPreview({ submission: draft, blob: await response.blob() });
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Ошибка предпросмотра');
    } finally { setBusy(false); }
  }

  if (!token) return <div className="admin-shell login-page"><a href="../" className="back"><ArrowLeft size={16} /> В библиотеку</a><form className="login-card" onSubmit={login}><div className="admin-logo"><ShieldCheck /></div><span className="section-kicker">CSD Library</span><h1>Вход для<br />модераторов</h1><p>Проверка материалов, предложенных студентами.</p><label>Пароль<div className="password-field"><KeyRound size={17} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus /></div></label>{error && <div className="form-error">{error}</div>}<button className="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : 'Войти в панель'}</button><span className={`login-status ${online ? 'ok' : ''}`}>{online === null ? 'Проверяем API…' : online ? 'Сервис доступен' : 'Публичный API не подключён'}</span></form></div>;

  return <div className="admin-shell moderation-shell">
    <aside><div className="brand"><span>C</span><b>CSD Library</b></div><div className="admin-nav"><small>Модерация</small><a className="active"><Clock3 />Очередь <b>{submissions.length}</b></a><a href="../"><ArrowLeft />Вернуться на сайт</a></div><button className="logout" onClick={logout}><LogOut />Выйти</button></aside>
    <section className="admin-content">
      <div className="admin-top"><div><span className="section-kicker">Админ-панель</span><h2>Проверка материалов</h2><p>Откройте файл, исправьте метаданные и подтвердите публикацию.</p></div><span className={`status ${online ? 'ok' : ''}`}><i />{online ? 'API работает' : 'API недоступен'}</span></div>
      {notice && <div className="success"><CheckCircle2 /><div><b>Готово</b><span>{notice}</span></div><button onClick={() => setNotice('')}><X /></button></div>}
      {error && <div className="form-error moderation-error">{error}</div>}
      <div className="moderation-layout">
        <div className="submission-list">
          <div className="queue-title"><b>Ожидают проверки</b><span>{submissions.length}</span></div>
          {submissions.length === 0 ? <div className="queue-empty"><CheckCircle2 /><b>Очередь пуста</b><span>Новые материалы появятся здесь.</span></div> : submissions.map((submission) => <button key={submission.id} className={submission.id === selectedId ? 'active' : ''} onClick={() => choose(submission)}><FileText /><span><b>{submission.title}</b><small>{submission.course} · {submission.subject}</small><small>{formatBytes(submission.size)} · {new Date(submission.createdAt).toLocaleDateString('ru')}</small></span></button>)}
        </div>
        <div className="moderation-card">
          {!draft ? <div className="queue-empty large"><Clock3 /><b>Выберите заявку</b><span>Здесь появятся файл и данные для проверки.</span></div> : <>
            <div className="moderation-file"><div><FileText /><span><b>{draft.fileName}</b><small>{formatBytes(draft.size)} · {draft.mimeType}</small></span></div><button onClick={openPreview} disabled={busy}><Eye /> Предпросмотр</button></div>
            <div className="field-grid moderation-fields">
              <label className="wide">Название<input value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} /></label>
              <label>Раздел / курс<input value={draft.course} onChange={(event) => updateDraft({ course: event.target.value })} /></label>
              <label>Предмет<input value={draft.subject} onChange={(event) => updateDraft({ subject: event.target.value })} /></label>
              <label>Тип<select value={draft.kind} onChange={(event) => updateDraft({ kind: event.target.value as Submission['kind'] })}><option value="lecture">Лекция</option><option value="seminar">Семинар</option><option value="exam">Экзамен</option><option value="book">Книга</option><option value="guide">Гайд</option><option value="homework">Задание</option><option value="other">Другое</option></select></label>
              <label>Теги<input value={draft.tags.join(', ')} onChange={(event) => updateDraft({ tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} /></label>
              <label className="wide">Описание<textarea rows={7} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} placeholder="Добавьте понятное описание материала" /></label>
            </div>
            <div className="submitter-note"><span>Предложил</span><b>{draft.submitter || 'Анонимный пользователь'}</b></div>
            <div className="moderation-actions"><button className="danger" onClick={() => act('reject')} disabled={busy}><Trash2 /> Отклонить</button><button className="secondary" onClick={() => save().catch((value) => setError(value.message))} disabled={busy}><Save /> Сохранить</button><button className="submit" onClick={() => act('approve')} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Check />} Опубликовать</button></div>
          </>}
        </div>
      </div>
    </section>
    {preview && <PendingPreview submission={preview.submission} blob={preview.blob} onClose={() => setPreview(null)} />}
  </div>;
}
