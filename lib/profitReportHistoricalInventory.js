// 자동 생성 파일 — scripts/extract-profit-report-historical-inventory.mjs
// 2026년 22~28차 원본 workbook의 기말상품재고액(F) 보조 증거.
// 다른 연도·차수로 전파하지 않으며, 현재 DB 공식이나 품목별 VERIFIED 단가가 없을 때만 사용한다.

const HISTORICAL_INVENTORY = {
  "22": {
    "fileHash": "72a8660e93d6593740246ddff5be74da0b10d0b4a07559f3fa06c4ce434252a0",
    "categories": {
      "콜롬비아 수국": {
        "value": 6620179.64,
        "sourceRef": "workbook-sha256:72a8660e93d6593740246ddff5be74da0b10d0b4a07559f3fa06c4ce434252a0#주차별 매출이익 보고서!F7",
        "sourceFile": "week-22.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F7",
        "formula": null
      },
      "콜롬비아 카네이션": {
        "value": 2461959.8,
        "sourceRef": "workbook-sha256:72a8660e93d6593740246ddff5be74da0b10d0b4a07559f3fa06c4ce434252a0#주차별 매출이익 보고서!F8",
        "sourceFile": "week-22.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F8",
        "formula": null
      },
      "콜롬비아 장미": {
        "value": 374777.04,
        "sourceRef": "workbook-sha256:72a8660e93d6593740246ddff5be74da0b10d0b4a07559f3fa06c4ce434252a0#주차별 매출이익 보고서!F9",
        "sourceFile": "week-22.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F9",
        "formula": null
      },
      "콜롬비아 루스커스": {
        "value": 139995.346,
        "sourceRef": "workbook-sha256:72a8660e93d6593740246ddff5be74da0b10d0b4a07559f3fa06c4ce434252a0#주차별 매출이익 보고서!F10",
        "sourceFile": "week-22.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F10",
        "formula": null
      },
      "콜롬비아 알스트로": {
        "value": 0,
        "sourceRef": "workbook-sha256:72a8660e93d6593740246ddff5be74da0b10d0b4a07559f3fa06c4ce434252a0#주차별 매출이익 보고서!F11",
        "sourceFile": "week-22.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F11",
        "formula": null
      },
      "호주": {
        "value": 14434813.15364451,
        "sourceRef": "workbook-sha256:72a8660e93d6593740246ddff5be74da0b10d0b4a07559f3fa06c4ce434252a0#주차별 매출이익 보고서!F13",
        "sourceFile": "week-22.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F13",
        "formula": null
      },
      "미국": {
        "value": 620250,
        "sourceRef": "workbook-sha256:72a8660e93d6593740246ddff5be74da0b10d0b4a07559f3fa06c4ce434252a0#주차별 매출이익 보고서!F17",
        "sourceFile": "week-22.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F17",
        "formula": null
      },
      "베트남": {
        "value": 6982642.85,
        "sourceRef": "workbook-sha256:72a8660e93d6593740246ddff5be74da0b10d0b4a07559f3fa06c4ce434252a0#주차별 매출이익 보고서!F21",
        "sourceFile": "week-22.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F21",
        "formula": null
      }
    }
  },
  "23": {
    "fileHash": "b4ebf36ae4253a8d501bcacc147793a0b037fd933e0a29c3c68d131755dc6f9e",
    "categories": {
      "콜롬비아 수국": {
        "value": 2219996.316,
        "sourceRef": "workbook-sha256:b4ebf36ae4253a8d501bcacc147793a0b037fd933e0a29c3c68d131755dc6f9e#주차별 매출이익 보고서!F7",
        "sourceFile": "week-23.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F7",
        "formula": null
      },
      "콜롬비아 카네이션": {
        "value": 2798767.51,
        "sourceRef": "workbook-sha256:b4ebf36ae4253a8d501bcacc147793a0b037fd933e0a29c3c68d131755dc6f9e#주차별 매출이익 보고서!F8",
        "sourceFile": "week-23.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F8",
        "formula": null
      },
      "콜롬비아 장미": {
        "value": 290862.657,
        "sourceRef": "workbook-sha256:b4ebf36ae4253a8d501bcacc147793a0b037fd933e0a29c3c68d131755dc6f9e#주차별 매출이익 보고서!F9",
        "sourceFile": "week-23.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F9",
        "formula": null
      },
      "콜롬비아 루스커스": {
        "value": 140999.75,
        "sourceRef": "workbook-sha256:b4ebf36ae4253a8d501bcacc147793a0b037fd933e0a29c3c68d131755dc6f9e#주차별 매출이익 보고서!F10",
        "sourceFile": "week-23.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F10",
        "formula": null
      },
      "콜롬비아 알스트로": {
        "value": 176004.9333,
        "sourceRef": "workbook-sha256:b4ebf36ae4253a8d501bcacc147793a0b037fd933e0a29c3c68d131755dc6f9e#주차별 매출이익 보고서!F11",
        "sourceFile": "week-23.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F11",
        "formula": null
      },
      "네덜란드": {
        "value": 350995,
        "sourceRef": "workbook-sha256:b4ebf36ae4253a8d501bcacc147793a0b037fd933e0a29c3c68d131755dc6f9e#주차별 매출이익 보고서!F12",
        "sourceFile": "week-23.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F12",
        "formula": null
      },
      "호주": {
        "value": 11490039.094,
        "sourceRef": "workbook-sha256:b4ebf36ae4253a8d501bcacc147793a0b037fd933e0a29c3c68d131755dc6f9e#주차별 매출이익 보고서!F13",
        "sourceFile": "week-23.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F13",
        "formula": null
      },
      "미국": {
        "value": 310125,
        "sourceRef": "workbook-sha256:b4ebf36ae4253a8d501bcacc147793a0b037fd933e0a29c3c68d131755dc6f9e#주차별 매출이익 보고서!F17",
        "sourceFile": "week-23.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F17",
        "formula": null
      },
      "베트남": {
        "value": 1420951,
        "sourceRef": "workbook-sha256:b4ebf36ae4253a8d501bcacc147793a0b037fd933e0a29c3c68d131755dc6f9e#주차별 매출이익 보고서!F21",
        "sourceFile": "week-23.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F21",
        "formula": null
      }
    }
  },
  "24": {
    "fileHash": "6b92bbfa32d1b65aa065c8868e35476b0a471d1d0e1b6c6ec22b8e4036ef8bae",
    "categories": {
      "콜롬비아 수국": {
        "value": 3147736.61,
        "sourceRef": "workbook-sha256:6b92bbfa32d1b65aa065c8868e35476b0a471d1d0e1b6c6ec22b8e4036ef8bae#주차별 매출이익 보고서!F7",
        "sourceFile": "week-24.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F7",
        "formula": null
      },
      "콜롬비아 카네이션": {
        "value": 2686256.95,
        "sourceRef": "workbook-sha256:6b92bbfa32d1b65aa065c8868e35476b0a471d1d0e1b6c6ec22b8e4036ef8bae#주차별 매출이익 보고서!F8",
        "sourceFile": "week-24.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F8",
        "formula": null
      },
      "콜롬비아 장미": {
        "value": 133892.3,
        "sourceRef": "workbook-sha256:6b92bbfa32d1b65aa065c8868e35476b0a471d1d0e1b6c6ec22b8e4036ef8bae#주차별 매출이익 보고서!F9",
        "sourceFile": "week-24.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F9",
        "formula": null
      },
      "콜롬비아 루스커스": {
        "value": 3135297.16,
        "sourceRef": "workbook-sha256:6b92bbfa32d1b65aa065c8868e35476b0a471d1d0e1b6c6ec22b8e4036ef8bae#주차별 매출이익 보고서!F10",
        "sourceFile": "week-24.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F10",
        "formula": null
      },
      "콜롬비아 알스트로": {
        "value": 88163.92,
        "sourceRef": "workbook-sha256:6b92bbfa32d1b65aa065c8868e35476b0a471d1d0e1b6c6ec22b8e4036ef8bae#주차별 매출이익 보고서!F11",
        "sourceFile": "week-24.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F11",
        "formula": null
      },
      "네덜란드": {
        "value": 0,
        "sourceRef": "workbook-sha256:6b92bbfa32d1b65aa065c8868e35476b0a471d1d0e1b6c6ec22b8e4036ef8bae#주차별 매출이익 보고서!F12",
        "sourceFile": "week-24.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F12",
        "formula": null
      },
      "호주": {
        "value": 15938013.144,
        "sourceRef": "workbook-sha256:6b92bbfa32d1b65aa065c8868e35476b0a471d1d0e1b6c6ec22b8e4036ef8bae#주차별 매출이익 보고서!F13",
        "sourceFile": "week-24.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F13",
        "formula": null
      },
      "태국": {
        "value": 0,
        "sourceRef": "workbook-sha256:6b92bbfa32d1b65aa065c8868e35476b0a471d1d0e1b6c6ec22b8e4036ef8bae#주차별 매출이익 보고서!F14",
        "sourceFile": "week-24.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F14",
        "formula": null
      },
      "중국": {
        "value": 0,
        "sourceRef": "workbook-sha256:6b92bbfa32d1b65aa065c8868e35476b0a471d1d0e1b6c6ec22b8e4036ef8bae#주차별 매출이익 보고서!F15",
        "sourceFile": "week-24.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F15",
        "formula": null
      },
      "에콰도르": {
        "value": 0,
        "sourceRef": "workbook-sha256:6b92bbfa32d1b65aa065c8868e35476b0a471d1d0e1b6c6ec22b8e4036ef8bae#주차별 매출이익 보고서!F16",
        "sourceFile": "week-24.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F16",
        "formula": null
      },
      "미국": {
        "value": 310125,
        "sourceRef": "workbook-sha256:6b92bbfa32d1b65aa065c8868e35476b0a471d1d0e1b6c6ec22b8e4036ef8bae#주차별 매출이익 보고서!F17",
        "sourceFile": "week-24.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F17",
        "formula": null
      },
      "베트남": {
        "value": 4965942,
        "sourceRef": "workbook-sha256:6b92bbfa32d1b65aa065c8868e35476b0a471d1d0e1b6c6ec22b8e4036ef8bae#주차별 매출이익 보고서!F21",
        "sourceFile": "week-24.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F21",
        "formula": null
      },
      "공제": {
        "value": 0,
        "sourceRef": "workbook-sha256:6b92bbfa32d1b65aa065c8868e35476b0a471d1d0e1b6c6ec22b8e4036ef8bae#주차별 매출이익 보고서!F22",
        "sourceFile": "week-24.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F22",
        "formula": null
      }
    }
  },
  "25": {
    "fileHash": "4d20160a362b7eee3fc0241ce9df880713b1eda2e4c01785a4cb654ce7aebf06",
    "categories": {
      "콜롬비아 수국": {
        "value": 998269.37,
        "sourceRef": "workbook-sha256:4d20160a362b7eee3fc0241ce9df880713b1eda2e4c01785a4cb654ce7aebf06#주차별 매출이익 보고서!F7",
        "sourceFile": "week-25.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F7",
        "formula": null
      },
      "콜롬비아 카네이션": {
        "value": 3539319.35,
        "sourceRef": "workbook-sha256:4d20160a362b7eee3fc0241ce9df880713b1eda2e4c01785a4cb654ce7aebf06#주차별 매출이익 보고서!F8",
        "sourceFile": "week-25.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F8",
        "formula": null
      },
      "콜롬비아 장미": {
        "value": 97862.83,
        "sourceRef": "workbook-sha256:4d20160a362b7eee3fc0241ce9df880713b1eda2e4c01785a4cb654ce7aebf06#주차별 매출이익 보고서!F9",
        "sourceFile": "week-25.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F9",
        "formula": null
      },
      "콜롬비아 루스커스": {
        "value": 3871762.2,
        "sourceRef": "workbook-sha256:4d20160a362b7eee3fc0241ce9df880713b1eda2e4c01785a4cb654ce7aebf06#주차별 매출이익 보고서!F10",
        "sourceFile": "week-25.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F10",
        "formula": null
      },
      "호주": {
        "value": 8285374.776,
        "sourceRef": "workbook-sha256:4d20160a362b7eee3fc0241ce9df880713b1eda2e4c01785a4cb654ce7aebf06#주차별 매출이익 보고서!F13",
        "sourceFile": "week-25.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F13",
        "formula": null
      }
    }
  },
  "26": {
    "fileHash": "b42bcce6779f2b31cfa6fc8393c3dde6827382495b1d63e3d8d01c1a40fe6f5a",
    "categories": {
      "콜롬비아 수국": {
        "value": 908773.47,
        "sourceRef": "workbook-sha256:b42bcce6779f2b31cfa6fc8393c3dde6827382495b1d63e3d8d01c1a40fe6f5a#주차별 매출이익 보고서!F7",
        "sourceFile": "week-26.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F7",
        "formula": null
      },
      "콜롬비아 카네이션": {
        "value": 1094084.76,
        "sourceRef": "workbook-sha256:b42bcce6779f2b31cfa6fc8393c3dde6827382495b1d63e3d8d01c1a40fe6f5a#주차별 매출이익 보고서!F8",
        "sourceFile": "week-26.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F8",
        "formula": null
      },
      "콜롬비아 장미": {
        "value": 377542.739,
        "sourceRef": "workbook-sha256:b42bcce6779f2b31cfa6fc8393c3dde6827382495b1d63e3d8d01c1a40fe6f5a#주차별 매출이익 보고서!F9",
        "sourceFile": "week-26.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F9",
        "formula": null
      },
      "호주": {
        "value": 2760184.6079999995,
        "sourceRef": "workbook-sha256:b42bcce6779f2b31cfa6fc8393c3dde6827382495b1d63e3d8d01c1a40fe6f5a#주차별 매출이익 보고서!F13",
        "sourceFile": "week-26.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F13",
        "formula": null
      },
      "베트남": {
        "value": 3779004.64,
        "sourceRef": "workbook-sha256:b42bcce6779f2b31cfa6fc8393c3dde6827382495b1d63e3d8d01c1a40fe6f5a#주차별 매출이익 보고서!F21",
        "sourceFile": "week-26.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F21",
        "formula": null
      }
    }
  },
  "27": {
    "fileHash": "2906ec876160f7fa2f0fbaeb1c9b89e49bda6a933cad9b7cabad9fbd7dd36689",
    "categories": {
      "콜롬비아 수국": {
        "value": 1793373.4,
        "sourceRef": "workbook-sha256:2906ec876160f7fa2f0fbaeb1c9b89e49bda6a933cad9b7cabad9fbd7dd36689#주차별 매출이익 보고서!F7",
        "sourceFile": "week-27.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F7",
        "formula": null
      },
      "콜롬비아 카네이션": {
        "value": 1404898.55,
        "sourceRef": "workbook-sha256:2906ec876160f7fa2f0fbaeb1c9b89e49bda6a933cad9b7cabad9fbd7dd36689#주차별 매출이익 보고서!F8",
        "sourceFile": "week-27.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F8",
        "formula": null
      },
      "콜롬비아 장미": {
        "value": 2010261.26,
        "sourceRef": "workbook-sha256:2906ec876160f7fa2f0fbaeb1c9b89e49bda6a933cad9b7cabad9fbd7dd36689#주차별 매출이익 보고서!F9",
        "sourceFile": "week-27.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F9",
        "formula": null
      },
      "네덜란드": {
        "value": 177446.63,
        "sourceRef": "workbook-sha256:2906ec876160f7fa2f0fbaeb1c9b89e49bda6a933cad9b7cabad9fbd7dd36689#주차별 매출이익 보고서!F12",
        "sourceFile": "week-27.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F12",
        "formula": null
      },
      "호주": {
        "value": 7843425.363500001,
        "sourceRef": "workbook-sha256:2906ec876160f7fa2f0fbaeb1c9b89e49bda6a933cad9b7cabad9fbd7dd36689#주차별 매출이익 보고서!F13",
        "sourceFile": "week-27.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F13",
        "formula": null
      }
    }
  },
  "28": {
    "fileHash": "d777e8745b3b1e2fbf89ac782633e9fd654f38fd7684ecbb620032221ecb156b",
    "categories": {
      "콜롬비아 수국": {
        "value": 3635624.828154121,
        "sourceRef": "workbook-sha256:d777e8745b3b1e2fbf89ac782633e9fd654f38fd7684ecbb620032221ecb156b#주차별 매출이익 보고서!F7",
        "sourceFile": "week-28.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F7",
        "formula": "(G7+H7)/SUMIF(구매현황!N:N,'주차별 매출이익 보고서'!B7,구매현황!D:D)*SUM(재고잔량!M7:M23)"
      },
      "콜롬비아 카네이션": {
        "value": 9409702.888094878,
        "sourceRef": "workbook-sha256:d777e8745b3b1e2fbf89ac782633e9fd654f38fd7684ecbb620032221ecb156b#주차별 매출이익 보고서!F8",
        "sourceFile": "week-28.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F8",
        "formula": "(G8+H8)/SUMIF(구매현황!N:N,'주차별 매출이익 보고서'!B8,구매현황!D:D)*SUM(재고잔량!M30:M32)"
      },
      "콜롬비아 장미": {
        "value": 1598667.1260439414,
        "sourceRef": "workbook-sha256:d777e8745b3b1e2fbf89ac782633e9fd654f38fd7684ecbb620032221ecb156b#주차별 매출이익 보고서!F9",
        "sourceFile": "week-28.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F9",
        "formula": "(G9+H9)/SUMIF(구매현황!N:N,'주차별 매출이익 보고서'!B9,구매현황!D:D)*재고잔량!M92"
      },
      "콜롬비아 루스커스": {
        "value": 578629.6307709508,
        "sourceRef": "workbook-sha256:d777e8745b3b1e2fbf89ac782633e9fd654f38fd7684ecbb620032221ecb156b#주차별 매출이익 보고서!F10",
        "sourceFile": "week-28.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F10",
        "formula": "(G10+H10)/SUMIF(구매현황!N:N,'주차별 매출이익 보고서'!B10,구매현황!D:D)*재고잔량!M72"
      },
      "콜롬비아 알스트로": {
        "value": 63272.881316055114,
        "sourceRef": "workbook-sha256:d777e8745b3b1e2fbf89ac782633e9fd654f38fd7684ecbb620032221ecb156b#주차별 매출이익 보고서!F11",
        "sourceFile": "week-28.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F11",
        "formula": "(G11+H11)/SUMIF(구매현황!N:N,'주차별 매출이익 보고서'!B11,구매현황!D:D)*SUM(재고잔량!M79:M85)"
      },
      "네덜란드": {
        "value": 206316.3,
        "sourceRef": "workbook-sha256:d777e8745b3b1e2fbf89ac782633e9fd654f38fd7684ecbb620032221ecb156b#주차별 매출이익 보고서!F12",
        "sourceFile": "week-28.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F12",
        "formula": null
      },
      "호주": {
        "value": 5322349.152,
        "sourceRef": "workbook-sha256:d777e8745b3b1e2fbf89ac782633e9fd654f38fd7684ecbb620032221ecb156b#주차별 매출이익 보고서!F13",
        "sourceFile": "week-28.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F13",
        "formula": null
      },
      "중국": {
        "value": 242459.2,
        "sourceRef": "workbook-sha256:d777e8745b3b1e2fbf89ac782633e9fd654f38fd7684ecbb620032221ecb156b#주차별 매출이익 보고서!F15",
        "sourceFile": "week-28.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F15",
        "formula": null
      },
      "베트남": {
        "value": 909607.4687068964,
        "sourceRef": "workbook-sha256:d777e8745b3b1e2fbf89ac782633e9fd654f38fd7684ecbb620032221ecb156b#주차별 매출이익 보고서!F21",
        "sourceFile": "week-28.xlsx",
        "sourceSheet": "주차별 매출이익 보고서",
        "sourceCell": "F21",
        "formula": "(G21+H21)/SUMIF(구매현황!N:N,'주차별 매출이익 보고서'!B21,구매현황!D:D)*SUM(재고잔량!M152:M155)"
      }
    }
  }
};

export const HISTORICAL_INVENTORY_YEAR = '2026';

export function getHistoricalClosingInventoryEvidence(orderYear, major, category) {
  if (String(orderYear) !== HISTORICAL_INVENTORY_YEAR) return null;
  const week = String(Number(major)).padStart(2, '0');
  const item = HISTORICAL_INVENTORY[week]?.categories?.[category];
  return item ? { ...item, orderYear: HISTORICAL_INVENTORY_YEAR, major: week, status: 'VERIFIED_HISTORICAL_WORKBOOK' } : null;
}

export function historicalInventoryMajors() { return Object.keys(HISTORICAL_INVENTORY); }
