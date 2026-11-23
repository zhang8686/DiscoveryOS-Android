import { Text, View, type JSX } from "nsh";
import { palette } from "./appearance";

function SkeletonRow(): JSX.Element {
  return (
    <View
      style={{
        height: 64,
        marginBottom: 3,
        paddingHorizontal: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: palette().surface,
        borderRadius: 6,
      }}
    >
      <View style={{ width: 34, height: 34, borderRadius: 7, backgroundColor: palette().border }} />
      <View style={{ flex: 1, gap: 7 }}>
        <View style={{ height: 11, width: "78%", borderRadius: 4, backgroundColor: palette().border }} />
        <View style={{ height: 9, width: "46%", borderRadius: 4, backgroundColor: palette().border }} />
      </View>
    </View>
  );
}

/**
 * Quiet stand-ins shown while the first page of a list is on the wire. They reserve the same
 * height as real rows, so the list does not jump when the answer arrives. No images, timers
 * or network: cheaper than the rows they replace, and something to show on a slow link instead
 * of an empty column with a spinner. A fixed set of rows is built (nsh JSX has no `key` prop).
 */
export function ListSkeleton(props: { rows?: number; title?: string }) {
  const count = Math.max(0, Math.min(20, props.rows ?? 8));
  const rows: JSX.Element[] = [];
  for (let i = 0; i < count; i++) rows.push(<SkeletonRow />);
  return (
    <View style={{ flex: 1 }}>
      {props.title ? (
        <Text style={{ fontSize: 12, color: palette().muted, paddingHorizontal: 8, paddingVertical: 6 }}>{props.title}</Text>
      ) : null}
      {rows}
    </View>
  );
}

/** One floor's stand-in: the face, the name line and a few lines of words. */
function ReplySkeletonRow(props: { lines: number }): JSX.Element {
  const lines: JSX.Element[] = [];
  for (let i = 0; i < props.lines; i++) {
    lines.push(
      <View style={{ height: 10, width: i === props.lines - 1 ? "58%" : "100%", borderRadius: 4, backgroundColor: palette().border }} />,
    );
  }
  return (
    <View style={{ marginBottom: 10, padding: 10, flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: palette().surface, borderRadius: 8 }}>
      <View style={{ width: 36, height: 36, borderRadius: 6, backgroundColor: palette().border }} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={{ height: 10, width: "34%", borderRadius: 4, backgroundColor: palette().border }} />
        {lines}
      </View>
    </View>
  );
}

/**
 * The same quiet stand-in for a thread: a couple of floors of the height they take, so opening a
 * thread shows its shape at once instead of a spinner in an empty column, and the page settles
 * into place when the replies arrive. A fixed set is built (nsh JSX has no `key` prop).
 */
export function ThreadSkeleton(props: { rows?: number }) {
  const count = Math.max(0, Math.min(6, props.rows ?? 3));
  const rows: JSX.Element[] = [];
  for (let i = 0; i < count; i++) rows.push(<ReplySkeletonRow lines={i === 0 ? 5 : 3} />);
  return <View style={{ paddingHorizontal: 4, paddingTop: 6 }}>{rows}</View>;
}
