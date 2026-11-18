# ClassFarm 등록 근거 (2026-11-18)

실제 `C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe`를 로컬 dnSpy.Console.exe `--no-color -t ClassFarm`으로 확인했다. decompile 근거도 `C:/Users/USER/nenova-decompiled/Nenova/ClassFarm.cs`와 일치한다.

- `ClassFarm.Select`: FarmKey/FarmCode/FarmName/CounKey/isDeleted/Descr 및 작성·최종변경 ID/시각을 Farm에서 읽으며 isDeleted=0, ORDER BY FarmKey.
- `ClassFarm.Insert`: FarmCode/FarmName/CounKey/isDeleted/Descr/CreateID/CreateDtm/LastUpdateID/LastUpdateDtm만 INSERT. LoginID와 GETDATE() 사용. Warehouse/Order/Shipment/Stock/Estimate 및 SP 호출 없음.
- 운영 read-only sys.columns probe: FarmKey int IDENTITY, FarmName nvarchar(100), FarmCode nvarchar(20), Descr nvarchar(200), ID nvarchar(50). 실제 IDENTITY이므로 수기 MAX+1 키를 추가하지 않는다.
- 운영 SELECT 활성 Farm의 Balverde41, Kikuyal20 및 국가 콜롬비아 확인. 운영 INSERT/UPDATE/DELETE/DDL 0.
- 웹은 동일 필드와 DB identity를 사용하되, 명시 권한·확인, 활성 Country, 직렬화 중복 잠금, OUTPUT readback과 실패 rollback을 추가한다. 자동 등록/삭제 농장 복원/기존 입고명 변경 없음.
- 격리 SQL2022 고정 loopback14339, 고유 폐기 DB에서 동시중복 1행, 삭제국가/이름 별칭 충돌 차단, INSERT 후 실패 rollback, native SELECT readback, 2025/2026 sentinel 보존 검증. 재현: `node scripts/test-farm-master-sql.cjs`.

기준·부작용: `docs/plans/manifest-farm-match-2026-11-18.md`. 기존 전산 산식/수식 변경 없음.
