export const PrivilegeType = {
  Create: 1,
  Read: 2,
  Write: 3,
  Append: 7,
  AppendTo: 8,
} as const satisfies Record<string, ComponentFramework.PropertyHelper.Types.PrivilegeType>;

export const PrivilegeDepth = {
  Basic: 0,
} as const satisfies Record<string, ComponentFramework.PropertyHelper.Types.PrivilegeDepth>;
