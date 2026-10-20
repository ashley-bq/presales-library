// 生成示例旧 PPTX（模拟历史材料）：samples/tech-ai-platform.pptx
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PptxGenJS from 'pptxgenjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE';
pptx.title = '科技-AI中台建设方案（中小行）';
const FONT = 'Microsoft YaHei';
pptx.defineSlideMaster({
  title: 'OLD',
  background: { color: 'FFFFFF' },
  objects: [
    { rect: { x: 0, y: 0, w: 13.333, h: 0.18, fill: { color: '1F4E79' } } },
    { text: { text: 'XX科技 · 售前方案', options: { x: 0.5, y: 7.0, w: 6, h: 0.3, fontSize: 10, color: '888888', fontFace: FONT } } },
    { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.35, w: 12.3, h: 0.9, fontSize: 28, bold: true, color: '1F4E79', fontFace: FONT }, text: '' } },
  ],
});

let s = pptx.addSlide({ masterName: 'OLD' });
s.addText('中小银行 AI 中台建设方案', { placeholder: 'title' });
s.addText('以"小投入、快见效"为原则，构建可复用的 AI 能力底座', { x: 0.8, y: 2.6, w: 11.5, h: 1, fontSize: 24, color: '333333', fontFace: FONT });
s.addText('面向：城商行 / 农商行    2026 年', { x: 0.8, y: 3.8, w: 11.5, h: 0.6, fontSize: 16, color: '666666', fontFace: FONT });

s = pptx.addSlide({ masterName: 'OLD' });
s.addText('中小行建设 AI 能力的三大痛点', { placeholder: 'title' });
[['算力与人才不足', '难以自建大模型团队，单点项目各自为战'], ['场景分散', '客服、营销、风控各自采购，能力无法复用'], ['合规要求高', '数据不出行、模型可解释、过程可审计']].forEach(([t, d], i) => {
  s.addShape(pptx.ShapeType.roundRect, { x: 0.6 + i * 4.15, y: 1.8, w: 3.9, h: 4.2, fill: { color: 'EEF3F8' }, line: { color: '1F4E79', width: 1 }, rectRadius: 0.1 });
  s.addText(t, { x: 0.8 + i * 4.15, y: 2.1, w: 3.5, h: 0.7, fontSize: 22, bold: true, color: '1F4E79', fontFace: FONT });
  s.addText(d, { x: 0.8 + i * 4.15, y: 3.0, w: 3.5, h: 2.5, fontSize: 16, color: '333333', fontFace: FONT, valign: 'top' });
});
s.addNotes('讲解重点：先共情痛点，再引出中台方案。');

s = pptx.addSlide({ masterName: 'OLD' });
s.addText('AI 中台总体架构（融合一页）', { placeholder: 'title' });
const rows = [['应用层', ['智能客服', '营销助手', '信贷审批助手', '运营数字员工']], ['能力层', ['大模型网关', '知识库 RAG', '智能体编排', '模型评测']], ['数据层', ['数据中台', '向量库', '权限与审计']]];
rows.forEach(([label, cells], r) => {
  s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.6 + r * 1.75, w: 1.8, h: 1.5, fill: { color: '1F4E79' } });
  s.addText(label, { x: 0.6, y: 1.6 + r * 1.75, w: 1.8, h: 1.5, fontSize: 20, bold: true, color: 'FFFFFF', align: 'center', fontFace: FONT });
  const w = 10.2 / cells.length;
  cells.forEach((c, i) => {
    s.addShape(pptx.ShapeType.rect, { x: 2.6 + i * w, y: 1.6 + r * 1.75, w: w - 0.15, h: 1.5, fill: { color: 'EEF3F8' }, line: { color: 'BBCCDD' } });
    s.addText(c, { x: 2.6 + i * w, y: 1.6 + r * 1.75, w: w - 0.15, h: 1.5, fontSize: 18, color: '333333', align: 'center', fontFace: FONT });
  });
});

s = pptx.addSlide({ masterName: 'OLD' });
s.addText('某农商行：智能客服上线 3 个月成效', { placeholder: 'title' });
s.addChart(pptx.ChartType.bar, [{ name: '人工坐席占比', labels: ['上线前', '第1月', '第2月', '第3月'], values: [100, 72, 55, 41] }], { x: 0.6, y: 1.6, w: 7.2, h: 5, barDir: 'col', chartColors: ['1F4E79'], showValue: true, valAxisMaxVal: 100 });
s.addText([{ text: '问题解决率 86%', options: { bullet: true, breakLine: true } }, { text: '坐席人力释放 59%', options: { bullet: true, breakLine: true } }, { text: '客户满意度 +12 分', options: { bullet: true } }], { x: 8.2, y: 2.0, w: 4.6, h: 3, fontSize: 20, color: '333333', fontFace: FONT });

await pptx.writeFile({ fileName: path.join(here, 'tech-ai-platform.pptx') });
console.log('已生成 samples/tech-ai-platform.pptx');
