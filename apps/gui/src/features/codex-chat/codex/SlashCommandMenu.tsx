import {
	AtSign,
	Cpu,
	FilePlus,
	FileText,
	GitBranch,
	Info,
	LogOut,
	Minimize2,
	Paperclip,
	Pin,
	Play,
	Plus,
	Search,
	Shield,
	Trash2,
	Wrench,
	X,
	Zap,
} from 'lucide-react';
import type { CustomPrompt, SkillMetadata } from '@/types/codex';
import type { SlashCommand } from './slash-commands';
import { MENU_STYLES } from './styles/menu-styles';
import { highlightMatches } from './utils';

type FilteredSlashCommand = {
	cmd: SlashCommand;
	indices: number[] | null;
};

type FilteredPrompt = {
	prompt: CustomPrompt;
	indices: number[] | null;
};

type FilteredSkill = {
	skill: SkillMetadata;
	indices: number[] | null;
};

interface SlashCommandMenuProps {
	filteredCommands: FilteredSlashCommand[];
	filteredPrompts: FilteredPrompt[];
	filteredSkills: FilteredSkill[];
	pinnedPromptNames: Set<string>;
	pinnedSkillNames: Set<string>;
	highlightIndex: number;
	onHighlight: (index: number) => void;
	onSelectCommand: (id: string) => void;
	onSelectPrompt: (prompt: CustomPrompt) => void;
	onSelectSkill: (skill: SkillMetadata) => void;
	onTogglePromptPin: (promptName: string) => void;
	onToggleSkillPin: (skillName: string) => void;
}

function iconForCommand(icon: SlashCommand['icon']) {
	switch (icon) {
		case 'cpu':
			return Cpu;
		case 'shield':
			return Shield;
		case 'zap':
			return Zap;
		case 'search':
			return Search;
		case 'plus':
			return Plus;
		case 'play':
			return Play;
		case 'file-plus':
			return FilePlus;
		case 'minimize':
			return Minimize2;
		case 'git-branch':
			return GitBranch;
		case 'at-sign':
			return AtSign;
		case 'info':
			return Info;
		case 'tool':
			return Wrench;
		case 'log-out':
			return LogOut;
		case 'x':
			return X;
		case 'message':
			return FileText;
		case 'trash':
			return Trash2;
		case 'paperclip':
			return Paperclip;
		default:
			return Search;
	}
}

export function SlashCommandMenu({
	filteredCommands,
	filteredPrompts,
	filteredSkills,
	pinnedPromptNames,
	pinnedSkillNames,
	highlightIndex,
	onHighlight,
	onSelectCommand,
	onSelectPrompt,
	onSelectSkill,
	onTogglePromptPin,
	onToggleSkillPin,
}: SlashCommandMenuProps) {
	return (
		<>
			{/* Commands section */}
			{filteredCommands.length > 0 && (
				<>
					<div className={MENU_STYLES.popoverTitle}>Commands</div>
					{filteredCommands.map(({ cmd, indices }, idx) => {
						const IconComponent = iconForCommand(cmd.icon);
						return (
							<button
								key={cmd.id}
								type="button"
								data-highlighted={idx === highlightIndex}
								className={idx === highlightIndex ? MENU_STYLES.popoverItemActive : MENU_STYLES.popoverItem}
								onClick={() => onSelectCommand(cmd.id)}
								onMouseEnter={() => onHighlight(idx)}
							>
								<IconComponent className={`${MENU_STYLES.iconSm} shrink-0 text-text-menuLabel`} />
								<span>{indices && indices.length > 0 ? highlightMatches(cmd.label, indices) : cmd.label}</span>
								<span className={MENU_STYLES.popoverItemDesc} title={cmd.description}>
									{cmd.description}
								</span>
							</button>
						);
					})}
				</>
			)}
			{/* Prompts section */}
			{filteredPrompts.length > 0 && (
				<>
					<div className={`${MENU_STYLES.popoverTitle} ${filteredCommands.length > 0 ? 'mt-2 border-t border-border-menuDivider pt-2' : ''}`}>Prompts</div>
					{filteredPrompts.map(({ prompt, indices }, idx) => {
						const globalIdx = filteredCommands.length + idx;
						const isPinned = pinnedPromptNames.has(prompt.name);
						return (
							<button
								key={prompt.name}
								type="button"
								data-highlighted={globalIdx === highlightIndex}
								className={globalIdx === highlightIndex ? MENU_STYLES.popoverItemActive : MENU_STYLES.popoverItem}
								onClick={() => onSelectPrompt(prompt)}
								onMouseEnter={() => onHighlight(globalIdx)}
							>
								<FileText className={`${MENU_STYLES.iconSm} shrink-0 text-text-menuLabel`} />
								<span className="min-w-0 flex-1 truncate">
									{indices && indices.length > 0 ? highlightMatches(`prompts:${prompt.name}`, indices) : `prompts:${prompt.name}`}
								</span>
								<span className={MENU_STYLES.popoverItemDesc} title={prompt.description || 'send saved prompt'}>
									{prompt.description || 'send saved prompt'}
								</span>
								<span
									role="button"
									aria-label={isPinned ? '取消固定 prompt' : '固定 prompt'}
									className={[
										'ml-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded',
										isPinned ? 'text-primary' : 'text-text-menuLabel hover:bg-white/10 hover:text-text-main',
									].join(' ')}
									onClick={(e) => {
										e.preventDefault();
										e.stopPropagation();
										onTogglePromptPin(prompt.name);
									}}
								>
									<Pin className="h-3.5 w-3.5" />
								</span>
							</button>
						);
					})}
				</>
			)}
			{/* Skills section */}
			{filteredSkills.length > 0 && (
				<>
					<div
						className={`${MENU_STYLES.popoverTitle} ${
							filteredCommands.length > 0 || filteredPrompts.length > 0 ? 'mt-2 border-t border-border-menuDivider pt-2' : ''
						}`}
					>
						Skills
					</div>
					{filteredSkills.map(({ skill, indices }, idx) => {
						const globalIdx = filteredCommands.length + filteredPrompts.length + idx;
						const isPinned = pinnedSkillNames.has(skill.name);
						return (
							<button
								key={skill.name}
								type="button"
								data-highlighted={globalIdx === highlightIndex}
								className={globalIdx === highlightIndex ? MENU_STYLES.popoverItemActive : MENU_STYLES.popoverItem}
								onClick={() => onSelectSkill(skill)}
								onMouseEnter={() => onHighlight(globalIdx)}
							>
								<Zap className={`${MENU_STYLES.iconSm} shrink-0 text-text-menuLabel`} />
								<span className="min-w-0 flex-1 truncate">{indices && indices.length > 0 ? highlightMatches(skill.name, indices) : skill.name}</span>
								<span className={MENU_STYLES.popoverItemDesc} title={skill.shortDescription || skill.description}>
									{skill.shortDescription || skill.description}
								</span>
								<span
									role="button"
									aria-label={isPinned ? '取消固定 skill' : '固定 skill'}
									className={[
										'ml-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded',
										isPinned ? 'text-primary' : 'text-text-menuLabel hover:bg-white/10 hover:text-text-main',
									].join(' ')}
									onClick={(e) => {
										e.preventDefault();
										e.stopPropagation();
										onToggleSkillPin(skill.name);
									}}
								>
									<Pin className="h-3.5 w-3.5" />
								</span>
							</button>
						);
					})}
				</>
			)}
			{/* Empty state */}
			{filteredCommands.length === 0 && filteredPrompts.length === 0 && filteredSkills.length === 0 ? (
				<div className={`${MENU_STYLES.popoverItemDesc} px-2 py-1`}>No matching commands, prompts or skills</div>
			) : null}
		</>
	);
}
