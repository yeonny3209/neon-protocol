// 화면 비율로 가로형/세로형 두 가지만 고른다.
export type Orient = 'landscape' | 'portrait';

export function currentOrient(): Orient {
  return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
}

export function watchOrient(cb?: (o: Orient) => void) {
  const apply = () => {
    const o = currentOrient();
    if (document.documentElement.dataset.orient !== o) {
      document.documentElement.dataset.orient = o;
      cb?.(o);
    }
  };
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
}
