# 从 Manim 示例到叙事技巧

来源：[Manim Community Example Gallery](https://docs.manim.community/en/stable/examples.html)，2026-10-29 阅读，页面版本 v0.22.1。页面声明示例为 MIT。以下为针对本工作台的分析与改写，没有复制整套示例。它是 **Community Edition（CE）** 画廊；当前执行引擎是 **ManimGL 1.7.2**，不能直接照搬 `from manim import *` 或 CE 相机/API。上游 manimgl-best-practices 的许可保持独立，见其 LICENSE.txt。

## 按表达问题挑技巧

| 官网示例 | 吸收的视觉语法 | 对我们的视频有什么用 | 取舍与误用 |
| --- | --- | --- | --- |
| MovingAround、OpeningManim | 同一对象的位置、形状、颜色连续变化；分组错峰进入；旧元素转成下一幕的锚点 | 报告从“生成”变“核对”；一个问题展开成系统，再收回人的选择。让观众认得对象、少重新读屏 | 转场必须保留语义身份；无关对象不硬变形；不要照搬示例里的网格和公式 |
| MovingFrameBox、BraceAnnotation | 移动焦点框、括注和局部标签 | 把注意力从“快”移到“可靠”，解释差距、代价或真正的卡点 | 一次突出一个重点；括号和箭头不应替代论证；中文用 Text，避免 get_tex 引入 LaTeX |
| PointMovingOnShapes、PointWithTrace | 一个主体沿路径运动并留下可读轨迹 | 呈现选择、反复返工、信息传递、累积后果；结尾回看自己走过的路，形成情绪回扣 | 轨迹要代表文章里的过程，不随意把位置当时间/数值；长路径降低点密度并停止已完成的更新器 |
| MovingAngle、MovingDots、PolygonOnAxes | 一个参数驱动多个相关对象，连线和标签跟随更新 | 让观众看到资源变化、阈值和约束如何改变结果；“原来不是我不努力，而是条件变了”须有内容依据 | 联动动画只能演示已说明的机制；示意要标明，不把同步运动伪装成实证因果 |
| BooleanOperations | 交集、差集、包含关系从整体中分离出来 | 讲清能力与授权、需求与供给、已知与未知的边界 | 有实际集合含义才用；圈大小不能暗示无来源的比例；概念边界未必能精确几何化 |
| FollowingGraphCamera、MovingZoomedSceneAround | 全景定位 → 跟随主体/放大细节 → 回到整体 | 先让观众看到熟悉的处境，再揭示藏在细节里的问题，最后理解整体 | 手机竖屏容易迷失；放大前后留锚点，相机停稳后再读字。局部放大可用复制图形的插图窗，不强依赖 CE ZoomedScene |
| SineCurveUnitCircle | 机制运行与结果轨迹同时生成，连接线解释对应关系 | 用“双视图”展示一个动作如何形成后果，而非先给图再念结论 | 不必画正弦；按文章重构循环/反馈/累积机制。没有定量数据时不画看似实测的坐标曲线 |
| GraphAreaPlot、ArgMinExample、HeatDiagramPlot | 面积、最优点、分段变化、对照曲线 | 有依据的累计成本、转折点和权衡可以被看见 | 数轴、单位、来源、假设必须明确。不要为让观点漂亮而编数字或光滑曲线 |
| ThreeDLightSourcePosition、ThreeDCameraRotation、ThreeDSurfacePlot | 光照、遮挡、深度、视角揭示结构 | 空间结构或多层系统确实需要深度时，让“看不见的一层”显现 | 3D 不是高级感的默认答案；无空间问题优先清楚的2D/2.5D。停转再读文字；当前场景类仍为 Scene |
| ManimCELogo、GradientImageFromArray | 有控制的色彩关系、负空间、层叠与色阶 | 画面气质来自构图与材质；背景为前景留安静区域 | 仅借鉴配色与构图，不添加 Logo/品牌名；数组图像接口在 GL 不保证一致，当前优先程序化几何色层 |

## 审美与导演决策

- 先画能成立的静态关键构图，再决定什么必须运动。主物、次物、背景的视觉重量明确；每幕的视觉中心能一眼找到。
- 一个物体跨镜头保留形状、颜色或位置锚点；色彩有语义，例如“已核对”和“待核对”的颜色在全片一致。避免每幕全清空后换一页。
- 视觉复杂度跟着理解任务变化：建立处境时少，展开机制时增加，落点时收束。不是全片都挤满元素，也不是全片都空。
- 运动有起势、推进、停顿和落点。信息到达时给观众读取时间；情绪转折可通过密度、空间、速度与明暗变化表达，不只靠字幕写“焦虑/释然”。
- 优先挑一至两种适合题目的主技巧形成全片语言，其余只辅助；不按技巧数量评判成片，也不规定所有题都用节点、闸门或纸张。

## CE → GL 适配边界

| CE 写法/概念 | 当前 ManimGL 的实现方向 |
| --- | --- |
| `from manim import *`、`Create` | `from manimlib import *`、通常使用 `ShowCreation`；查上游规则确认参数 |
| `Axes.plot` | GL `Axes.get_graph`；坐标转换可检查 `c2p`；绘图参数不要机械照搬 |
| `MovingCameraScene`、CE `ThreeDScene` 的相机控制 | 当前 `DraftVideoScene(Scene)` 使用 `self.camera.frame`；保存/恢复 frame 状态、移动/缩放，3D 角度查 `set_euler_angles` |
| `add_fixed_in_frame_mobjects` | GL 对字幕等对象使用 `fix_in_frame()`，避免相机运动影响阅读 |
| `ZoomedScene` | 优先移动 frame 或用复制局部图形的插图窗；不能假设 CE 的双相机接口可用 |
| `MathTex`、`Brace.get_tex` | 当前中文场景无 LaTeX 依赖，用 Text 与几何标签重构 |
| ValueTracker、updater、路径、Boolean 几何 | GL 有相关能力，但签名/对象生命周期要查已加载技能与 GL 版本；真实试渲染确认 |

以上是实现方向，不是对所有参数的兼容承诺。不要为迁移示例修改渲染隔离规则；不兼容时换等效视觉表达。

坐标运算使用三维向量 `[x, y, 0]`，传给 `move_to`、`shift`、线段端点的二维元组需先补零；NumPy数组没有 `.normalize()`，用ManimGL的 `normalize(vector)`，或非零长度检查后除以 `np.linalg.norm(vector)`。辅助函数应明确颜色与位置参数，复杂调用使用关键字，避免把位置元组传给颜色参数。
