/** 公共菜单样式配置 */
export const MENU_STYLES = {
	/** 弹出菜单容器 */
	popover: 'rounded-xl border border-border-menu bg-bg-menu/95 shadow-menu backdrop-blur ring-1 ring-border-menuInner',
	/** 弹出菜单标题 */
	popoverTitle: 'px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-text-menuLabel',
	/** 弹出菜单选项 */
	popoverItem: 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-text-main transition-colors hover:bg-bg-menuItemHover group',
	/** 弹出菜单选项（高亮/聚焦） */
	popoverItemActive: 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] bg-bg-menuItemHover text-text-main transition-colors group',
	/** 弹出菜单选项描述 */
	popoverItemDesc: 'ml-2.5 shrink-0 max-w-[220px] truncate text-[10px] text-text-menuDesc',
	/** 图标尺寸 */
	iconSm: 'h-3.5 w-3.5',
	iconMd: 'h-4 w-4',
	/** 搜索输入框 */
	searchInput: 'w-full bg-transparent text-[12px] text-text-muted outline-none placeholder:text-text-menuDesc',
	/** 弹出菜单位置 */
	popoverPosition: 'absolute bottom-full left-0 right-0 z-50 mb-2 p-2',
	/** 列表容器 */
	listContainer: 'max-h-[240px] overflow-auto',
} as const;

export const SIDEBAR_WIDTH_PX = 48 * 0.7;
export const SIDEBAR_ICON_BUTTON_PX = SIDEBAR_WIDTH_PX * 0.7;
