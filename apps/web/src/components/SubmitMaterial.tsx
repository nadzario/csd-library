import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, CloudUpload, File, LoaderCircle, Send, X } from 'lucide-react';
import { formatBytes } from '@csd/shared';
import { requireApiUrl } from '../lib/api';

export function SubmitMaterial({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return setError('Выберите файл');
    setBusy(true);
    setError('');
    try {
      const data = new FormData(event.currentTarget);
      data.set('file', file);
      const response = await fetch(`${requireApiUrl()}/api/submissions`, { method: 'POST', body: data });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Не удалось отправить материал');
      setSent(true);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Не удалось отправить материал');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="submission-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="submission-modal" role="dialog" aria-modal="true" aria-label="Предложить материал">
        <div className="submission-head">
          <div><span className="section-kicker">Пополнить библиотеку</span><h2>Предложить материал</h2></div>
          <button onClick={onClose} aria-label="Закрыть"><X /></button>
        </div>
        {sent ? (
          <div className="submission-sent">
            <CheckCircle2 />
            <h3>Материал отправлен</h3>
            <p>Он появился в очереди модерации. После проверки администратором файл будет опубликован в каталоге.</p>
            <button className="submit" onClick={onClose}>Готово</button>
          </div>
        ) : (
          <form className="submission-form" onSubmit={submit}>
            <label className={`dropzone ${file ? 'selected' : ''}`}>
              <input type="file" name="file" onChange={(event) => setFile(event.target.files?.[0] || null)} />
              {file ? <><File /><b>{file.name}</b><span>{formatBytes(file.size)} · нажмите, чтобы заменить</span></> : <><CloudUpload /><b>Выберите файл</b><span>PDF, документ, изображение или архив · до 100 МБ</span></>}
            </label>
            <div className="field-grid">
              <label className="wide">Название<input name="title" required maxLength={180} placeholder="Что это за материал?" /></label>
              <label>Раздел / курс<input name="course" required maxLength={120} placeholder="2 курс" /></label>
              <label>Предмет<input name="subject" required maxLength={180} placeholder="Линейная алгебра" /></label>
              <label>Тип<select name="kind" defaultValue="other"><option value="lecture">Лекция</option><option value="seminar">Семинар</option><option value="exam">Экзамен</option><option value="book">Книга</option><option value="guide">Гайд</option><option value="homework">Задание</option><option value="other">Другое</option></select></label>
              <label>Автор / контакт<input name="submitter" maxLength={180} placeholder="@username или имя" /></label>
              <label className="wide">Теги<input name="tags" placeholder="экзамен, билеты, 2026" /></label>
              <label className="wide">Описание<textarea name="description" rows={4} maxLength={4000} placeholder="Что находится внутри и кому пригодится" /></label>
              <label className="submission-honeypot" aria-hidden="true">Компания<input name="company" tabIndex={-1} autoComplete="off" /></label>
            </div>
            {error && <div className="form-error">{error}</div>}
            <div className="submission-actions">
              <p>Файл станет общедоступным только после проверки администратором.</p>
              <button className="submit" disabled={busy || !file}>{busy ? <><LoaderCircle className="spin" /> Отправляем…</> : <><Send /> Отправить на проверку</>}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
