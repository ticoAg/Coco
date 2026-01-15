import { Zap } from 'lucide-react';
import type { SkillMetadata } from '../../types/codex';
import { MENU_STYLES } from './styles/menu-styles';
import { highlightMatches } from './utils';

type FilteredSkill = {
	skill: SkillMetadata;
	indices: number[] | null;
};

interface SkillMenuProps {
	skills: SkillMetadata[];
	filteredSkills: FilteredSkill[];
	highlightIndex: number;
	onHighlight: (index: number) => void;
	onSelect: (skill: SkillMetadata) => void;
}

export function SkillMenu({ skills, filteredSkills, highlightIndex, onHighlight, onSelect }: SkillMenuProps) {
	if (filteredSkills.length > 0) {
		return (
			<>
				{filteredSkills.map(({ skill, indices }, idx) => (
					<button
						key={skill.name}
						type="button"
						data-highlighted={idx === highlightIndex}
						className={idx === highlightIndex ? MENU_STYLES.popoverItemActive : MENU_STYLES.popoverItem}
						onClick={() => onSelect(skill)}
						onMouseEnter={() => onHighlight(idx)}
					>
						<Zap className={`${MENU_STYLES.iconSm} shrink-0 text-text-menuLabel`} />
						<span>{indices && indices.length > 0 ? highlightMatches(skill.name, indices) : skill.name}</span>
						<span className={MENU_STYLES.popoverItemDesc} title={skill.shortDescription || skill.description}>
							{skill.shortDescription || skill.description}
						</span>
					</button>
				))}
			</>
		);
	}

	return <div className={`${MENU_STYLES.popoverItemDesc} px-2 py-1`}>{skills.length === 0 ? 'No skills available' : 'No matching skills'}</div>;
}
