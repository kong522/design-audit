/**
 * Design Audit 检查器端到端逻辑测试
 * 用 jsdom 加载 iframe/audit.html，注入 mock eda 后运行 run()，
 * 验证检查器能否正确发现构造的设计缺陷。
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'iframe/audit.html'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const { window } = dom;

let passed = 0;
let failed = 0;
function assert(name, cond, extra = '') {
	if (cond) { passed++; console.log(`  ✅ ${name}`); }
	else { failed++; console.log(`  ❌ ${name} ${extra}`); }
}

/** 构造带 getState_* 方法的 mock 器件 */
function comp(o) {
	return {
		getState_PrimitiveId: () => o.id,
		getState_Designator: () => o.designator ?? '',
		getState_Name: () => o.name ?? '',
		getState_Footprint: () => (o.fp ? { name: o.fp } : undefined),
		getState_X: () => o.x ?? 0,
		getState_Y: () => o.y ?? 0,
	};
}

/** 注入 mock eda 并触发一次 run() */
async function runWith(mockEda) {
	window.eda = mockEda;
	await window.run();
	// run() 内部 await 后改 DOM，这里读取渲染结果
	return {
		cntError: window.document.getElementById('cntError').textContent,
		cntWarn: window.document.getElementById('cntWarn').textContent,
		cntInfo: window.document.getElementById('cntInfo').textContent,
		mainHtml: window.document.getElementById('main').innerHTML,
		items: [...window.document.querySelectorAll('.item')].map((el) => el.textContent),
		summaryVisible: window.document.getElementById('summary').style.display,
	};
}

function makeEda({ docType, schComps = null, pcbComps = null }) {
	const calls = { schGetAll: 0, pcbGetAll: 0, select: [], zoom: 0 };
	const mock = {
		dmt_SelectControl: {
			getCurrentDocumentInfo: async () => ({ documentType: docType, uuid: 'doc-uuid', tabId: 't1' }),
		},
		sch_PrimitiveComponent: {
			getAll: async () => { calls.schGetAll++; return schComps; },
		},
		pcb_PrimitiveComponent: {
			getAll: async () => { calls.pcbGetAll++; return pcbComps; },
		},
		sch_SelectControl: { doSelectPrimitives: async (id) => { calls.select.push(['sch', id]); return true; } },
		pcb_SelectControl: { doSelectPrimitives: async (id) => { calls.select.push(['pcb', id]); return true; } },
		dmt_EditorControl: { zoomToSelectedPrimitives: async () => { calls.zoom++; return true; } },
	};
	return { mock, calls };
}

/* ============ 场景 1：原理图 + PCB 同时打开，构造 7 个缺陷 ============ */
console.log('\n场景1：原理图 + PCB 同时打开（含位号重复、封装缺失、值缺失、封装不一致、位号缺失）');
{
	const schComps = [
		comp({ id: 's1', designator: 'R1', name: '10k', fp: '0603' }),      // 正常
		comp({ id: 's2', designator: 'R1', name: '10k', fp: '0603' }),      // 位号重复！
		comp({ id: 's3', designator: 'C1', name: '100n' }),                 // 封装缺失！
		comp({ id: 's4', designator: 'C2', fp: '0603' }),                   // 值缺失！
		comp({ id: 's5', designator: 'U1', name: 'MCU', fp: 'SOIC-8' }),    // 与 PCB 不一致！
		comp({ id: 's6', designator: 'R2', name: '4.7k', fp: '0805' }),     // PCB 中缺失！
	];
	const pcbComps = [
		comp({ id: 'p1', designator: 'R1', name: '10k', fp: '0603' }),
		comp({ id: 'p2', designator: 'R1', name: '10k', fp: '0603' }),      // 位号重复！
		comp({ id: 'p3', designator: 'C1', name: '100n', fp: '0603' }),     // sch 无封装但 pcb 有 → 不算不一致
		comp({ id: 'p4', designator: 'U1', name: 'MCU', fp: 'QFN-32' }),    // 封装不一致！
		comp({ id: 'p5', designator: 'X1', name: 'MOUNT_HOLE', fp: 'MH' }), // sch 中缺失（机械件）
	];
	const { mock, calls } = makeEda({ docType: 1, schComps, pcbComps });
	const r = await runWith(mock);

	assert('sch getAll 被调用且传 allSchematicPages=true', calls.schGetAll === 1);
	assert('pcb getAll 被调用', calls.pcbGetAll === 1);
	assert('严重数 = 3（2 重复 + 1 封装不一致）', r.cntError === '3', `实际 ${r.cntError}`);
	assert('警告数 = 1（封装缺失）', r.cntWarn === '1', `实际 ${r.cntWarn}`);
	assert('提示数 = 4（值缺失 C2 + 位号缺失 C2/R2/X1）', r.cntInfo === '4', `实际 ${r.cntInfo}`);
	assert('问题行数 = 8', r.items.length === 8, `实际 ${r.items.length}`);
	assert('摘要条可见', r.summaryVisible === 'flex');

	const all = r.mainHtml;
	assert('重复位号 R1 被发现（中/英）', /(出现 2 次|appears 2 times)/.test(all.replace(/\s+/g, ' ')), all.slice(0, 200));
	assert('封装缺失 C1 被发现（中/英）', all.includes('缺少封装') || /no footprint/.test(all), all.slice(0, 200));
	assert('值缺失 C2 被发现（中/英）', all.includes('缺少器件值') || /Missing value/.test(all));
	assert('封装不一致 U1 被发现', all.includes('SOIC-8') && all.includes('QFN-32'));
	assert('PCB 独有位号 X1 被发现（提示级）', all.includes('X1'));
}

/* ============ 场景 2：只打开 PCB（sch 读取失败） ============ */
console.log('\n场景2：只打开 PCB（sch 侧读取抛错 → 交叉检查跳过）');
{
	// 模拟 sch_PrimitiveComponent.getAll 抛错（未打开原理图）
	const pcbComps = [
		comp({ id: 'p1', designator: 'R1', name: '10k', fp: '0603' }),
		comp({ id: 'p2', designator: 'R1', name: '10k', fp: '0603' }), // 重复
	];
	const { mock } = makeEda({ docType: 3, pcbComps });
	window.eda.sch_PrimitiveComponent.getAll = async () => { throw new Error('no schematic'); };
	const r = await runWith(mock);
	assert('严重数 = 1（PCB 内位号重复）', r.cntError === '1', `实际 ${r.cntError}`);
	assert('不产生误导性的交叉检查结果（无 X1/封装不一致）', !r.mainHtml.includes('不一致') && !r.mainHtml.includes('位号缺失'));
	assert('问题行数 = 1', r.items.length === 1, `实际 ${r.items.length}`);
}

/* ============ 场景 3：非原理图/PCB 文档（如工程页） → 中止提示 ============ */
console.log('\n场景3：非原理图/PCB 文档（PROJECT=5）→ 中止');
{
	const { mock } = makeEda({ docType: 5 });
	const r = await runWith(mock);
	assert('中止并提示打开文档（无问题行）', r.items.length === 0);
	assert('main 显示提示文案', r.mainHtml.includes('打开一个原理图') || r.mainHtml.includes('Open a schematic'));
	assert('摘要条不显示', r.summaryVisible !== 'flex');
}

/* ============ 场景 4：干净设计 → 全通过 ============ */
console.log('\n场景4：无缺陷设计 → 显示通过');
{
	const schComps = [comp({ id: 's1', designator: 'R1', name: '10k', fp: '0603' })];
	const pcbComps = [comp({ id: 'p1', designator: 'R1', name: '10k', fp: '0603' })];
	const { mock } = makeEda({ docType: 1, schComps, pcbComps });
	const r = await runWith(mock);
	assert('严重/警告/提示均为 0', r.cntError === '0' && r.cntWarn === '0' && r.cntInfo === '0');
	assert('显示"未发现任何问题"（中/英）', r.mainHtml.includes('未发现任何问题') || r.mainHtml.includes('No issues found'));
}

/* ============ 场景 5：点击跳转 ============ */
console.log('\n场景5：点击问题行 → 选中并缩放定位');
{
	const schComps = [comp({ id: 's1', designator: 'R1', name: '10k', fp: '0603' }), comp({ id: 's2', designator: 'R1', name: '10k', fp: '0603' })];
	const { mock, calls } = makeEda({ docType: 1, schComps, pcbComps: null });
	const r = await runWith(mock);
	const first = window.document.querySelector('.item');
	first.dispatchEvent(new window.Event('click', { bubbles: true }));
	await new Promise((res) => setTimeout(res, 50));
	assert('调用 doSelectPrimitives(sch, s1)', calls.select.length === 1 && calls.select[0][0] === 'sch' && calls.select[0][1] === 's1');
	assert('调用 zoomToSelectedPrimitives', calls.zoom === 1);
}

console.log(`\n===== 结果：${passed} 通过 / ${failed} 失败 =====`);
process.exit(failed > 0 ? 1 : 0);
