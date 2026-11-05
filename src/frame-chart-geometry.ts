export function frameChartGeometry(
  frames: readonly { interval: number }[],
  budget: number,
  overLimit: number,
  slots: number,
  scaleCeiling = 0,
) {
  const width = 300;
  const height = 96;
  const ceiling = Math.max(
    budget,
    budget <= Number.MAX_VALUE / 2 ? budget * 2 : budget,
    ...frames.map((frame) => frame.interval),
    scaleCeiling,
  );
  const y = (value: number) => height - (value / ceiling) * height;
  const budgetY = y(budget);
  const pitch = width / slots;
  const left = (slots - frames.length) * pitch;
  let line = "";
  let area = "";
  let over = "";
  frames.forEach((frame, index) => {
    const x = left + index * pitch;
    const end = x + pitch;
    const top = y(frame.interval);
    line += `${index ? "V" : `M${x.toFixed(2)},`}${top.toFixed(2)}H${end.toFixed(2)}`;
    area += `${index ? "V" : `M${left},${height}V`}${y(Math.min(frame.interval, budget)).toFixed(2)}H${end.toFixed(2)}`;
    if (frame.interval > overLimit)
      over += `M${x.toFixed(2)},${budgetY.toFixed(2)}V${top.toFixed(2)}H${end.toFixed(2)}V${budgetY.toFixed(2)}Z`;
  });
  if (area) area += `V${height}Z`;
  return { width, height, ceiling, budgetY, pitch, left, line, area, over };
}
