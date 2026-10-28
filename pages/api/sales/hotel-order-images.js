import { withAuth } from '../../../lib/auth';
import images from '../../../lib/hotelOrderImages.cjs';
export const config = { api: { bodyParser:false, responseLimit:'16mb' } };
export default withAuth(async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  try {
    if (req.method === 'GET') {
      const image = await images.read(req.user?.userId, req.query.id);
      res.setHeader('Content-Type',image.mime);
      res.setHeader('Content-Disposition','inline');
      return res.send(image.buffer);
    }
    if (req.method === 'POST') {
      const chunks=[]; let size=0;
      for await (const chunk of req) { size+=chunk.length; if(size<=images.MAX_BYTES) chunks.push(chunk); }
      if(size>images.MAX_BYTES) return res.status(413).json({error:'이미지는 최대 15MB까지 업로드할 수 있습니다.'});
      return res.json({success:true,...await images.save(req.user?.userId,Buffer.concat(chunks))});
    }
    res.setHeader('Allow','GET, POST'); return res.status(405).json({error:'지원하지 않는 요청입니다.'});
  } catch(e) { return res.status(e.statusCode || 500).json({error:e.statusCode ? e.message : '이미지 보관에 실패했습니다. 다시 업로드하세요.'}); }
});
