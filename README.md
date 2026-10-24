# 네온 프로토콜

웹 브라우저용 턴제 RPG. 정적 파일만으로 돌아가고, 저장은 브라우저 로컬 저장소를 쓴다.

## 실행

```bash
npm install
npm run dev        # 개발 서버 (같은 와이파이의 아이패드에서 http://<이 PC IP>:5173 으로 접속)
npm test           # 자동 테스트
npm run sim        # 밸런스 시뮬레이션 (전투 길이, 가챠 확률, 재화 수급)
npm run build      # dist/ 에 정적 파일 생성
```

- 전투 프로토타입만 바로 해 보려면 주소 뒤에 `#proto`를 붙인다.

## 문서

- `docs/PLAN.md` — 기획서 (원본: `docs/plan-original.pdf`)
- `docs/DECISIONS.md` — 기획서가 비어 있거나 부딪히는 부분을 어떻게 정했는지
- `docs/DATA.md` — 데이터 파일 구조, 캐릭터 추가하는 법
- `docs/CHECKLIST.md` — 12.2 내부 검증 체크리스트와 본편 시뮬레이션 결과 (`npx vitest run tests/progression.test.ts`)
