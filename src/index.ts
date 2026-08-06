/**
 * Design Audit / 设计一致性审查 — 入口文件
 *
 * 菜单入口（extension.json headerMenus）通过方法名关联到本文件导出的方法：
 *   - openAuditPanel: 打开审查面板（iframe 内完成全部检查逻辑，直接访问 eda）
 *   - about: 关于对话框
 */
import extensionConfig from '../extension.json' with { type: 'json' };

const PANEL_ID = 'design-audit-panel';

/** 打开审查面板（内联框架） */
export async function openAuditPanel(): Promise<void> {
	// 面板内 (iframe/audit.html) 拥有完整 DOM，并可直接访问 eda 对象，
	// 因此检查逻辑、结果渲染与跳转定位全部在面板内完成。
	try {
		const ok = await eda.sys_IFrame.openIFrame(
			'/iframe/audit.html',
			960,
			640,
			PANEL_ID,
			{
				title: '设计一致性审查',
				maximizeButton: true,
				minimizeButton: true,
			},
		);
		if (!ok) {
			eda.sys_ToastMessage.showMessage(
				eda.sys_I18n.text('panel.open.failed'),
				ESYS_ToastMessageType.ERROR,
			);
		}
	}
	catch (error) {
		console.error('[Design Audit] open panel failed', error);
		eda.sys_ToastMessage.showMessage(
			eda.sys_I18n.text('panel.open.failed'),
			ESYS_ToastMessageType.ERROR,
		);
	}
}

/** 关于对话框 */
export function about(): void {
	eda.sys_Dialog.showInformationMessage(
		eda.sys_I18n.text('about.description', undefined, undefined, extensionConfig.version),
		eda.sys_I18n.text('about.title'),
	);
}
