import { Grid3X3 } from 'lucide-react';
import { CategoryIcon } from '../lib/category-icons';
import { usePOSStore } from '../store/pos-store';
import { SidebarContainer, cn } from '@ury/ui';
import CommentDialog from './CommentDialog';
import { useState, type ReactNode } from 'react';
import { t } from '../i18n';

// Course names are often typed in ALL CAPS; title-case those so the list is easier to scan
const toDisplayLabel = (label: string) =>
  label && label === label.toUpperCase()
    ? label.toLowerCase().replace(/(^|[\s(&/-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
    : label;

interface CategoryButtonProps {
  label: string;
  title?: string;
  count: number;
  active: boolean;
  disabled?: boolean;
  icon: ReactNode;
  onClick: () => void;
}

const CategoryButton = ({ label, title, count, active, disabled, icon, onClick }: CategoryButtonProps) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title ?? label}
    aria-current={active ? 'true' : undefined}
    className={cn(
      'group relative w-full flex items-center gap-2.5 min-h-[44px] ps-2 pe-2.5 py-1.5 rounded-lg text-start',
      'text-sm transition-colors duration-150 select-none touch-manipulation active:scale-[0.99]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
      active
        ? 'bg-white text-blue-700 font-semibold shadow-sm ring-1 ring-blue-100'
        : 'text-gray-700 font-medium hover:bg-white hover:text-gray-900'
    )}
  >
    {active && <span className="absolute start-0 top-2 bottom-2 w-1 rounded-e-full bg-blue-600" />}
    <span
      className={cn(
        'flex items-center justify-center w-8 h-8 rounded-md shrink-0 transition-colors',
        active ? 'bg-blue-50 text-blue-600' : 'bg-white text-gray-500 ring-1 ring-gray-200 group-hover:text-gray-700'
      )}
    >
      {icon}
    </span>
    <span className="flex-1 min-w-0 leading-snug line-clamp-2 break-words">{label}</span>
    <span
      className={cn(
        'shrink-0 min-w-[28px] h-6 px-1.5 inline-flex items-center justify-center rounded-full text-xs font-semibold tabular-nums',
        active ? 'bg-blue-600 text-white' : 'bg-gray-200/70 text-gray-600'
      )}
    >
      {count}
    </span>
  </button>
);

interface SidebarProps {
  disabled?: boolean;
}

const Sidebar = ({ disabled }: SidebarProps) => {
  const { selectedCategory, setSelectedCategory, menuItems, categories, orderComment, setOrderComment } = usePOSStore();
  const [showCommentDialog, setShowCommentDialog] = useState(false);

  // Count items per category
  const getCategoryCount = (category: string) => {
    const count = menuItems.filter(item => item.course === category).length;
    return count;
  };

  const getAllItemsCount = () => {
    const count = menuItems.length;
    return count;
  };

  const handleCommentSave = (comment: string) => {
    setOrderComment(comment);
  };

  return (
    <SidebarContainer disabled={disabled} className="w-60 bg-gray-50/70">
      {/* Section Title — stays put while the list scrolls */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
          {t('pos_sidebar.categories')}
        </h2>
        <span className="text-[11px] font-medium text-gray-400 tabular-nums">{categories.length}</span>
      </div>

      {/* Categories List */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-4 [scrollbar-width:thin] [scrollbar-color:theme(colors.gray.300)_transparent]">
        <CategoryButton
          label={t('pos_sidebar.all_items')}
          count={getAllItemsCount()}
          active={selectedCategory === ''}
          disabled={disabled}
          onClick={() => setSelectedCategory('')}
          icon={<Grid3X3 className="w-4 h-4" />}
        />

        {/* Divider */}
        <div className="h-px bg-gray-200 my-2 mx-2" />

        {/* Category Items */}
        <div className="space-y-0.5">
          {categories.map((category) => (
            <CategoryButton
              key={category.name}
              label={toDisplayLabel(category.label)}
              title={category.label}
              count={getCategoryCount(category.name)}
              active={selectedCategory === category.name}
              disabled={disabled}
              onClick={() => setSelectedCategory(category.name)}
              icon={
                <CategoryIcon
                  name={category.icon}
                  courseName={category.name}
                  className="w-4 h-4"
                />
              }
            />
          ))}
        </div>
      </nav>

      {/* Comment Dialog is rendered from sidebar but triggered from order panel, to not mount it on every order panel render */}
      <CommentDialog
        isOpen={showCommentDialog}
        onClose={() => setShowCommentDialog(false)}
        onSave={handleCommentSave}
        initialComment={orderComment}
      />
    </SidebarContainer>
  );
};

export default Sidebar; 