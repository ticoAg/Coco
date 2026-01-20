/** 公共菜单样式配置 */
export const MENU_STYLES = {
	/** 弹出菜单容器 */
	popover: 'rounded-xl bg-bg-popover shadow-menu',
	/** 弹出菜单标题 */
	popoverTitle: 'px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-text-menuLabel',
	/** 弹出菜单选项 */
	popoverItem: 'flex h-7 w-full items-center gap-1.5 rounded-lg px-2.5 text-left text-[12px] leading-4 text-text-main transition-colors hover:bg-bg-menuItemHover group',
	/** 弹出菜单选项（高亮/聚焦） */
	popoverItemActive:
		'flex h-7 w-full items-center gap-1.5 rounded-lg px-2.5 text-left text-[12px] leading-4 bg-bg-menuItemHover text-text-main transition-colors group',
	/** 弹出菜单选项描述 */
	popoverItemDesc: 'ml-2 shrink-0 max-w-[220px] truncate text-[10px] text-text-menuDesc',
	/** 弹出菜单选项描述（占满剩余空间，超出截断） */
	popoverItemDescFill: 'min-w-0 flex-1 truncate text-[10px] text-text-menuDesc',
	/** 图标尺寸 */
	iconSm: 'h-3 w-3',
	iconMd: 'h-4 w-4',
	/** 搜索输入框 */
	searchInput: 'w-full bg-transparent text-[12px] text-text-muted outline-none placeholder:text-text-menuDesc',
	/** 弹出菜单位置 */
	popoverPosition: 'absolute bottom-full left-0 right-0 z-40 mb-2 p-2',
	/** 列表容器 */
	// Keep the popover bounded to ~11 visible items (11 * 28px = 308px).
	listContainer: 'max-h-[min(308px,40vh)] overflow-auto',
} as const;

export const SIDEBAR_WIDTH_PX = 48 * 0.7;
export const SIDEBAR_EXPANDED_WIDTH_PX = 260;
export const SIDEBAR_ICON_BUTTON_PX = SIDEBAR_WIDTH_PX * 0.7;
