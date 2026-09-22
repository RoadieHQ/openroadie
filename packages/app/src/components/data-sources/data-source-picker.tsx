import { useMemo } from 'react';
import { Layers } from 'lucide-react';
import { IntegrationLogo } from '@roadiehq/ui/item-list';
import {
  PickerCombobox,
  type PickerComboboxGroup,
} from '../common/picker-combobox';

export interface DataSourcePickerOption {
  id: string;
  name: string;
  logoUrl?: string;
}

/** Pinned cross-source option rendered above (and apart from) the DS list. */
export interface DataSourcePickerAllOption {
  id: string;
  label: string;
}

interface DataSourcePickerProps {
  dataSources: DataSourcePickerOption[];
  groups?: PickerComboboxGroup[];
  value?: string;
  onChange: (id: string) => void;
  label?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  allOption?: DataSourcePickerAllOption;
  className?: string;
  popoverContentClassName?: string;
  'data-testid'?: string;
}

/**
 * The unified data source dropdown: the same searchable icon combobox as the
 * integration selector, flavored for DataSourceItem-shaped options.
 */
export function DataSourcePicker({
  dataSources,
  groups,
  value,
  onChange,
  label,
  placeholder,
  ariaLabel,
  disabled,
  allOption,
  className,
  popoverContentClassName,
  'data-testid': dataTestId,
}: DataSourcePickerProps) {
  const resolvedGroups = useMemo<PickerComboboxGroup[]>(() => {
    if (groups) {
      if (!allOption) {
        return groups;
      }
      return [
        {
          options: [
            {
              id: allOption.id,
              label: allOption.label,
              icon: (
                <Layers className="size-5 text-muted-foreground" aria-hidden />
              ),
            },
          ],
        },
        ...groups,
      ];
    }
    const dataSourceGroup: PickerComboboxGroup = {
      label: allOption ? 'Data sources' : undefined,
      options: dataSources.map(ds => ({
        id: ds.id,
        label: ds.name,
        icon: <IntegrationLogo src={ds.logoUrl ?? ''} size={20} />,
      })),
    };
    if (!allOption) {
      return [dataSourceGroup];
    }
    return [
      {
        options: [
          {
            id: allOption.id,
            label: allOption.label,
            icon: (
              <Layers className="size-5 text-muted-foreground" aria-hidden />
            ),
          },
        ],
      },
      dataSourceGroup,
    ];
  }, [dataSources, allOption, groups]);

  return (
    <PickerCombobox
      groups={resolvedGroups}
      selectedId={value || undefined}
      onSelect={onChange}
      label={label}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      disabled={disabled}
      className={className}
      popoverContentClassName={popoverContentClassName}
      data-testid={dataTestId}
      unknownSelectionLabel={value}
    />
  );
}
