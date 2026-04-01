// pages/index.js — 루트: 로그인으로 리다이렉트
import { useEffect } from 'react';
import { useRouter } from 'next/router';
export default function Index() {
  const router = useRouter();
  useEffect(() => { router.replace('/login'); }, []);
  return null;
}
