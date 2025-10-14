export function deArray<T>(value: T | T[]) {
	if (Array.isArray(value)) return value.at(0);
	return value;
}
