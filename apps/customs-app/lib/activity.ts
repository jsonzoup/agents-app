/** 把工具调用写成工作台上能看懂的一行动作。 */
export function describeToolCall(name: string, args?: string): string {
  let parsed: Record<string, unknown> = {};
  if (args) {
    try {
      const value = JSON.parse(args) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }
  const file = typeof parsed.file_path === "string" ? parsed.file_path.split("/").pop() ?? "" : "";
  if (name === "read_image") return file ? `正在读取图片 ${file}` : "正在读取图片";
  if (name === "read" || name === "read_file") return file ? `正在阅读 ${file}` : "正在阅读文件";
  if (name === "write" || name === "edit") return file ? `正在写入 ${file}` : "正在写入文件";
  if (name === "bash") {
    const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
    return description || "正在执行命令";
  }
  if (name === "todo_write") return "正在更新处理清单";
  return name;
}
