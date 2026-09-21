# 거래처 관리 dnSpy 근거

2026-09-21: `dnSpy.Console.exe --no-color -t FormCustomerAdd "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"` 실행 확인.
저장 소스: `C:\Users\USER\nenova-decompiled\Nenova\FormCustomerInfo.cs`, `FormCustomerInfo.Designer.cs`, `FormCustomerAdd.cs`, `ClassCustomer.cs`.

- 목록: ClassCustomer.Select, Customer.isDeleted=0, CustKey 순서. 자동 열 필터.
- 열: CustKey, CustCode, CustName, CustArea, CEO, BusinessNumber, Manager, Tel, Mobile, BaseOutDay, OrderCode, Descr.
- GetData / btnSave_Click: CustCode, CustName, Group1, CustArea, BusinessNumber, CEO, Manager, ProductType, Tel, Mobile, OrderCode, BaseOutDay, Descr.
- Manager/CustArea는 자유 텍스트. ProductType과 UseType은 서로 다른 컬럼.
- 신규 Insert는 CustKey를 전달하지 않는다. 수정 Update는 CustKey로 한 행 지정. Delete는 isDeleted만 변경하는 소프트 삭제.
- WeekDay: 0 미지정, 1 일요일 ~ 7 토요일.

## 변경 범위

웹 수정 화면이 신규 INSERT만 호출하던 경로를 별도 API로 분리한다. Customer 지정 필드만 수정하고 SearchComment, UseType, TransType과 생성 이력은 보존한다. 신규는 EXE처럼 비표시 문자열 필드를 빈 값으로 초기화한다.
OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/ShipmentDate/ShipmentFarm/Estimate/WebProfitReport/Stock/Warehouse는 모든 연도에서 직접 쓰지 않는다. 향후 조회에 쓰이는 업체명·기본출고요일 변경은 Customer 기준정보의 정상 영향이다.

## read-only probe

EXE 연결 설정으로 read-only SELECT 수행: 활성 거래처 674개. sys.columns에서 CustKey int IDENTITY 확인. CustCode/CustName nvarchar(100), CEO/Group1/CustArea/Manager/Tel/Mobile nvarchar(50), BusinessNumber/ProductType/OrderCode nvarchar(20), Descr nvarchar(200). SearchComment/UseType/TransType 및 생성/수정 감사 컬럼 존재 확인. 운영 데이터는 수정하지 않음. 연결 비밀값은 출력·파일에 저장하지 않음.

모델: 메인 Codex. 별도 하위 모델 호출 도구가 없어 메인이 근거 분석과 구현 담당.
