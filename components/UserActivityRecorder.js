import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { startActivityRecorder } from '../lib/userActivityClient';

export default function UserActivityRecorder() {
  const router = useRouter(), recorder = useRef(null);
  const [status, setStatus] = useState({});
  useEffect(() => {
    const instance = startActivityRecorder(window, next => setStatus(previous => {
      if (!next.error && !next.transportError && !previous.error && !previous.transportError) return previous;
      if (previous.error === next.error && previous.transportError === next.transportError && previous.pending === next.pending) return previous;
      return next;
    })); recorder.current = instance;
    router.events.on('routeChangeComplete', instance.navigate);
    return () => { router.events.off('routeChangeComplete', instance.navigate); instance.stop(); recorder.current = null; };
  }, [router.events]);
  const message = status.error || status.transportError;
  if (!message) return null;
  return <div role="status" data-activity-private style={{ position: 'fixed', bottom: 8, right: 8, zIndex: 9999, maxWidth: 'min(420px, calc(100vw - 16px))', padding: '6px 10px', background: '#fff8df', border: '1px solid #d8ae42', borderRadius: 6, color: '#684600', fontSize: 12 }}>
    {message} {status.pending > 0 && `(${status.pending}건 보류)`}{' '}
    <button type="button" onClick={() => recorder.current?.retry()}>재시도</button>
  </div>;
}
