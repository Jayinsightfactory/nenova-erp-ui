# 공통 화면틀·메뉴 계약

## 한 화면에는 화면틀이 하나만 있어야 합니다

일반 페이지의 왼쪽 메뉴와 상단바는 `pages/_app.js`가 `components/Layout.js`를 통해 한 번만 만듭니다. `pages/**`의 개별 페이지는 내용만 반환해야 하며 `Layout`을 import하거나 `<Layout>...</Layout>`으로 다시 감싸면 안 됩니다.

```jsx
// 허용: 페이지는 내용만 반환
export default function NewPage() {
  return <section>새 화면 내용</section>;
}

// 금지: 같은 화면틀이 다시 생김
import Layout from '../components/Layout';
export default function NewPage() {
  return <Layout><section>새 화면 내용</section></Layout>;
}
```

전체화면·로그인·모바일 전용 또는 기존 자체 화면틀 페이지는 `_app.js`의 `NO_LAYOUT`에 명시합니다. 자체 화면틀을 유지하는 기존 페이지는 반드시 이 목록에 있어야 하며, 새 일반 페이지는 기본 방식대로 내용만 반환합니다.

## 일반 URL과 팝업 URL

- 일반 URL: 공통 shell 1개, 왼쪽 메뉴 1개, 상단바 1개입니다.
- `?popup=1`: 공통 `Layout`이 팝업 모드로 바뀌며 간소화 상단바 1개만 표시합니다. 왼쪽 메뉴는 0개입니다.
- iframe 또는 자식창도 기존 자동 접기 계약을 유지합니다.

DOM 회귀 검사는 `data-ui-shell`, `data-ui-sidebar`, `data-ui-topbar`, `data-ui-popupbar`, `data-ui-page-title`로 개수를 확인합니다. 스타일로 숨겨 중복을 가리지 않고 실제 DOM 개수를 검사합니다.

## 메뉴는 한 곳에 한 번만 등록합니다

새 메뉴는 `components/Layout.js`의 `MENU_ITEMS` 한 곳에만 추가합니다. 모바일 홈도 이 값을 그대로 사용합니다. 같은 `href` 또는 같은 `labelKey`를 두 번 등록하면 `npm run test:ui-layout`이 실패합니다.

## 데이터 표의 텍스트 열은 무제한으로 늘리지 않습니다

품목명·업체명처럼 글자가 들어가는 열에 `width: auto`를 주고 표를 `width: 100%`로 두면, 그 열이 화면의 남는 폭을 전부 흡수해 글자 오른쪽에 거대한 빈 공간이 생깁니다. 데이터 표는 다음을 지킵니다.

- 표는 `width: auto`(내용 폭 기준)로 두고, 화면이 좁을 때만 가로 스크롤합니다. `width: 100%` + 텍스트 열 `width: auto` 조합은 금지합니다.
- 모든 `<col>`에 고정 폭을 줍니다. 텍스트 열은 실제 내용에 맞는 상한(예: 잔량분배 게시판 품목명 360~480px)을 가지고, 넘치는 글자는 한 줄 말줄임표와 `title` 툴팁으로 보여줍니다.
- `col:not(.a):not(.b)` 같은 부정 선택자는 `col.diff` 같은 단일 클래스 규칙보다 특이도가 높아 개별 폭 지정을 조용히 무시시킵니다. 열마다 고유 클래스를 붙여 폭을 지정합니다.
- 한 화면에 주요 열이 모두 보이도록 1366×768 기준으로 열 폭 합계를 확인합니다.

잔량분배 게시판은 `__tests__/shillaMiuBoard.test.js`가 열 폭·행 높이·셀 여백 범위를 자동 검사합니다.

## 자동 검사와 작업 범위

- `npm run test:ui-layout`: 모든 페이지의 중첩 Layout, 메뉴 중복, 모바일 메뉴 복제 여부를 검사합니다.
- `node scripts/layout-shell-smoke.js`: 로그인 후 MOYI Drive 일반/popup URL을 실제 브라우저로 열어 DOM 개수, 제목, 콘텐츠 폭, console error/warn을 검사합니다.
- 이 계약은 웹 화면 구성만 다룹니다. MSSQL 조회·쓰기, 주문·출고·재고·견적·매출 원장은 변경하지 않습니다.

`pages/sales/shilla-miu-board.js`도 별도 동시 작업에서 단일 shell 방식으로 반영되었으며, 다른 페이지와 같은 정적 검사를 받습니다.
