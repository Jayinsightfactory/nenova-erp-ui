-- 2026-04-17  품목 자연어 표시명 (DisplayName) 추가
-- Product.ProdName 은 기존 그대로 유지
-- DisplayName: 웹/견적서 표시용 한글명 (NULL = ProdName 그대로 사용)

-- ① 컬럼 추가
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME='Product' AND COLUMN_NAME='DisplayName'
)
BEGIN
  ALTER TABLE Product ADD DisplayName NVARCHAR(200) NULL;
  PRINT 'DisplayName 컬럼 추가 완료';
END
ELSE
  PRINT 'DisplayName 컬럼 이미 존재';
GO

-- ② 콜롬비아 수국 (HYDRANGEA) 일괄 세팅
UPDATE Product
SET DisplayName =
  N'수국 ' +
  CASE
    WHEN ProdName LIKE '%WHITE%'    THEN N'화이트'
    WHEN ProdName LIKE '%PINK%'     THEN N'핑크'
    WHEN ProdName LIKE '%PURPLE%'   THEN N'퍼플'
    WHEN ProdName LIKE '%LAVENDER%' THEN N'라벤더'
    WHEN ProdName LIKE '%BLUE%'     THEN N'블루'
    WHEN ProdName LIKE '%RED%'      THEN N'레드'
    WHEN ProdName LIKE '%CREAM%'    THEN N'크림'
    WHEN ProdName LIKE '%CORAL%'    THEN N'코랄'
    WHEN ProdName LIKE '%PASTEL%'   THEN N'파스텔'
    WHEN ProdName LIKE '%MIXED%'    THEN N'믹스드'
    ELSE LTRIM(REPLACE(REPLACE(REPLACE(REPLACE(ProdName, 'HYDRANGEA', ''), 'COL', ''), 'ECU', ''), '  ', ' '))
  END
WHERE FlowerName = N'수국'
  AND CounName   = N'콜롬비아'
  AND isDeleted  = 0;

-- ③ 콜롬비아 카네이션 (CARNATION) 일괄 세팅
UPDATE Product
SET DisplayName =
  N'카네이션 ' +
  CASE
    WHEN ProdName LIKE '%MOON LIGHT%' OR ProdName LIKE '%MOONLIGHT%' THEN N'문라이트'
    WHEN ProdName LIKE '%WHITE%'      THEN N'화이트'
    WHEN ProdName LIKE '%PINK%'       THEN N'핑크'
    WHEN ProdName LIKE '%RED%'        THEN N'레드'
    WHEN ProdName LIKE '%YELLOW%'     THEN N'옐로우'
    WHEN ProdName LIKE '%ORANGE%'     THEN N'오렌지'
    WHEN ProdName LIKE '%PURPLE%'     THEN N'퍼플'
    WHEN ProdName LIKE '%CORAL%'      THEN N'코랄'
    WHEN ProdName LIKE '%PEACH%'      THEN N'피치'
    WHEN ProdName LIKE '%CREAM%'      THEN N'크림'
    WHEN ProdName LIKE '%SALMON%'     THEN N'살몬'
    WHEN ProdName LIKE '%BICOLOR%'    THEN N'바이컬러'
    WHEN ProdName LIKE '%LAVENDER%'   THEN N'라벤더'
    WHEN ProdName LIKE '%HOT PINK%'   THEN N'핫핑크'
    WHEN ProdName LIKE '%LIGHT PINK%' THEN N'라이트핑크'
    WHEN ProdName LIKE '%LEMON%'      THEN N'레몬'
    WHEN ProdName LIKE '%FANCY%'      THEN N'팬시'
    WHEN ProdName LIKE '%SWEET%'      THEN N'스위트'
    ELSE LTRIM(REPLACE(REPLACE(ProdName, 'CARNATION', ''), '  ', ' '))
  END
WHERE FlowerName = N'카네이션'
  AND CounName   = N'콜롬비아'
  AND isDeleted  = 0;

-- ④ 콜롬비아 장미 (ROSE) 일괄 세팅
UPDATE Product
SET DisplayName =
  N'장미 ' +
  CASE
    WHEN ProdName LIKE '%PLAYA BLANCA%'  THEN N'플라야블랑카'
    WHEN ProdName LIKE '%MOON LIGHT%' OR ProdName LIKE '%MOONLIGHT%' THEN N'문라이트'
    WHEN ProdName LIKE '%CHERRY BRANDY%' THEN N'체리브랜디'
    WHEN ProdName LIKE '%GOLDEN GATE%'   THEN N'골든게이트'
    WHEN ProdName LIKE '%FREEDOM%'       THEN N'프리덤'
    WHEN ProdName LIKE '%EXPLORER%'      THEN N'익스플로러'
    WHEN ProdName LIKE '%TYCOON%'        THEN N'타이쿤'
    WHEN ProdName LIKE '%TACAZZI%'       THEN N'타카치'
    WHEN ProdName LIKE '%MONDIAL%'       THEN N'몬디알'
    WHEN ProdName LIKE '%AKITO%'         THEN N'아키토'
    WHEN ProdName LIKE '%WHITE%'         THEN N'화이트'
    WHEN ProdName LIKE '%RED%'           THEN N'레드'
    WHEN ProdName LIKE '%PINK%'          THEN N'핑크'
    WHEN ProdName LIKE '%YELLOW%'        THEN N'옐로우'
    WHEN ProdName LIKE '%ORANGE%'        THEN N'오렌지'
    WHEN ProdName LIKE '%PURPLE%'        THEN N'퍼플'
    WHEN ProdName LIKE '%CORAL%'         THEN N'코랄'
    WHEN ProdName LIKE '%PEACH%'         THEN N'피치'
    WHEN ProdName LIKE '%CREAM%'         THEN N'크림'
    WHEN ProdName LIKE '%SALMON%'        THEN N'살몬'
    WHEN ProdName LIKE '%LAVENDER%'      THEN N'라벤더'
    WHEN ProdName LIKE '%PASTEL%'        THEN N'파스텔'
    ELSE LTRIM(REPLACE(REPLACE(REPLACE(ProdName, 'ROSE', ''), 'COL', ''), '  ', ' '))
  END
WHERE FlowerName = N'장미'
  AND CounName   = N'콜롬비아'
  AND isDeleted  = 0;

-- ⑤ 콜롬비아 알스트로 일괄 세팅
UPDATE Product
SET DisplayName =
  N'알스트로 ' +
  CASE
    WHEN ProdName LIKE '%WHITE%'    THEN N'화이트'
    WHEN ProdName LIKE '%PINK%'     THEN N'핑크'
    WHEN ProdName LIKE '%YELLOW%'   THEN N'옐로우'
    WHEN ProdName LIKE '%ORANGE%'   THEN N'오렌지'
    WHEN ProdName LIKE '%RED%'      THEN N'레드'
    WHEN ProdName LIKE '%PURPLE%'   THEN N'퍼플'
    WHEN ProdName LIKE '%LAVENDER%' THEN N'라벤더'
    WHEN ProdName LIKE '%SALMON%'   THEN N'살몬'
    WHEN ProdName LIKE '%CORAL%'    THEN N'코랄'
    WHEN ProdName LIKE '%PASTEL%'   THEN N'파스텔'
    WHEN ProdName LIKE '%MIXED%'    THEN N'믹스드'
    ELSE LTRIM(REPLACE(REPLACE(REPLACE(REPLACE(ProdName, 'ALSTROEMERIA', ''), 'ALSTROMERIA', ''), 'ALSTRO', ''), '  ', ' '))
  END
WHERE FlowerName = N'알스트로'
  AND CounName   = N'콜롬비아'
  AND isDeleted  = 0;

-- 결과 확인
SELECT FlowerName, CounName, ProdName, DisplayName
FROM Product
WHERE CounName = N'콜롬비아'
  AND isDeleted = 0
  AND FlowerName IN (N'수국', N'카네이션', N'장미', N'알스트로')
ORDER BY FlowerName, ProdName;
