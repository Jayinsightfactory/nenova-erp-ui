// 도착원가 전용 웹 원장 API
// GET  : 차수·국가·품종·품목·농장 검색
// POST : 전산 품목/농장 매칭 및 배분기준 저장

import { withAuth } from '../../../lib/auth.js';
import {
  listArrivalCost,
  listArrivalCostVarieties,
  searchArrivalCostFarms,
  updateArrivalCostLine,
  ARRIVAL_BASIS,
} from '../../../lib/arrivalCost.js';

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      if (req.query.lookup === 'varieties') {
        const data = await listArrivalCostVarieties({
          orderYear: req.query.orderYear,
          orderWeek: req.query.orderWeek,
        });
        return res.status(200).json({ success: true, ...data });
      }
      if (req.query.lookup === 'farms') {
        const farms = await searchArrivalCostFarms({ q: req.query.q, limit: req.query.limit });
        return res.status(200).json({ success: true, farms });
      }
      const data = await listArrivalCost({
        orderYear: req.query.orderYear,
        orderWeek: req.query.orderWeek,
        country: req.query.country,
        flower: req.query.flower,
        allVarieties: req.query.allVarieties === '1',
        product: req.query.product,
        farm: req.query.farm,
        includeHistory: req.query.includeHistory === '1',
        page: req.query.page,
        pageSize: req.query.pageSize,
      });
      return res.status(200).json({ success: true, basisOptions: ARRIVAL_BASIS, ...data });
    }
    if (req.method === 'POST') {
      const body = req.body || {};
      const row = await updateArrivalCostLine({
        lineId: body.arrivalLineKey,
        prodKey: body.prodKey,
        farmKey: body.farmKey,
        allocationBasis: body.allocationBasis || 'SOURCE',
        notes: body.notes,
        user: req.user,
      });
      return res.status(200).json({ success: true, row });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end();
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, error: error.message, code: error.code });
  }
});

