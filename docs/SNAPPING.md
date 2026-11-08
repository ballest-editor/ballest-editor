# Snapping

Status: built, apart from what § Still to come lists. This page is the feature: what the user sees and does, and the decisions behind it. The engine is `domain/snap*.ts`, `domain/connectors.ts` and `domain/joints.ts`, and its meeting with the scene `editor/snap/`. #84, #87, #88, #89, #92 and #99 are the issues this page took over.

The names here follow [AGENTS.md](../AGENTS.md) § Terms: a piece is a kind of thing in the catalog, an item is one placed in a map, a pane is one camera's view, the active pane is the last one hovered or clicked.

## Why

The game's in-game editor has a 10 cm grid and rotation steps, and that is what the editor has now. It is enough to lay pieces in a line and not enough to build a track: a Curve L joined to a Track S by eye leaves a step the ball feels, a kicker set level with a landing 40 m away takes arithmetic, and a piece dropped on a slope takes three gizmo drags. CAD tools solved this a long time ago (Rhino's object snaps and SmartTrack, AutoCAD's object snap tracking, FreeCAD's Draft Snap), 2D tools made it feel free (Excalidraw's alignment guides), and track-building games made it specific to tracks (end-to-end connectors). This design takes one part from each.

## Still to come

- **Connector data** covers every directional piece, read off the meshes, but only the Track, Bevel_F, Bevel_H and Bevel_C pieces of the first measurement are confirmed in the game ([qa/connectors.md](qa/connectors.md) § Not confirmed in the game). The player start and the goal have no ends yet, so Mesh carries them.
- **A prefab instance's ends** aren't found (§ Open questions).
- **A turn's base face** is drawn as the side of the selection's box, which is the piece's own face only while the piece is square to the world.
- **A turned grid in a side view** draws the line family nearest the view, spaced as it crosses the view. The other family's lines aren't drawn there.

## The model

Every snap answers three questions. Each feature below is a new answer to one of them, and the whole thing stays one feature because the answers combine freely.

1. **What point of the selection moves** (the snap base).
2. **Where it can land** (the snap targets).
3. **Which transforms it affects** (move, rotate, scale).

Blender's snapping is laid out this way and it is why its many snap types read as one tool. The additions here are the targets a track editor needs that a modeller doesn't: connectors, tracking and alignment.

### Snap base

Which point of the selection is matched to a target. One choice at a time, shown in the Snap popover.

| Base    | The point                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pivot   | The active unit's pivot, where the gizmo sits: the active item's own, or a whole group's ([DESKTOP.md § Pivot setting](DESKTOP.md#pivot-setting-together-and-each)). The default.           |
| Closest | Whichever of the selection's candidate points is nearest the target under the pointer: bounds corners, edge midpoints and face centres, plus the connector ends of any piece that has them. |
| Centre  | The centre of the selection's bounds.                                                                                                                                                       |

Closest is what makes dropping a piece against another feel right without first setting the pivot. The marked point jumps between candidates as the pointer moves toward different targets, and it is always drawn, so the user sees what is about to land where.

With the Connectors target on, a piece that has ends uses its nearest end as the base for a move whatever the base setting says. Joining end to end is the point of a piece with ends, and the pivot keeps its meaning for rotation and scale.

Under a handle or a lock the pivot and the selection's stations land too, whatever the setting says: its near face, centre and far face along each axis of the move, from its bounds. The one whose match is nearest is the one meant, as under Closest, and the status bar names it. They only land on targets: the grid and the drawn dot stay with what the setting names. The pivot stops at a Mesh station only when it sits on one of the selection's own (§ Under a constrained move).

### Snap targets

Where the base can land. Each target is a row in the Snap popover with its own toggle, its own parameters, and a place in the priority list (§ Priority). A target that is off contributes nothing.

#### Grid

The grid as today, with #84's additions:

- **Steps** for position, rotation and scale, each chosen from a list or typed. Scale steps are a percentage (10%, 25%, 50%, 100%) and apply along the item's own axes, as the game scales.
- **Origin**: the world's 0, 0, 0; a point picked in the viewport (any snap target can be the pick); or the selection, which puts the origin on the active pivot. "Grid origin to selection" is the move that makes a piece sitting at 137 cm the thing everything else lines up with.
- **Rotation**: the grid can take the selection's yaw, so a track built at 30° to the world gets a grid along it. Only yaw: a tilted grid is a construction plane's job.
- The ortho panes' grid and the perspective floor grid draw the configured grid, origin and rotation included, so what is seen is what snaps.

#### Connectors

The ends of track, ramp, tube and pipe pieces. A connector is a point on a piece, a direction it faces out of, an up direction, and a profile (the cross-section it presents: Track, Bevel_F, Bevel_C, Tube F, Tube H, Pipe Q and so on). The data is per piece and measured once, like `tools/extract/panel.json` (§ Connector data).

When the selection's end reaches another item's end, it lands on it, facing the opposite way, up matching up. The two pieces meet with no gap and no step. An end only joins what it is turned toward, within a right angle: a piece going past an end isn't turned round to meet it with its trailing end.

Parameters:

- **Range**: how far, in screen pixels, an end keeps hold of the selection, and how near it must be for a drop or a pick. The default is the general threshold (§ Settings).
- **Pull**: how hard ends pull against the Grid and Mesh, in five stops from ×0.25 to ×4, default ×1. The range is multiplied by it, and above ×1 Connectors is also asked ahead of Grid and Mesh (§ Priority).
- **Match rotation**: on by default. The piece turns so the ends face each other and their up directions agree. Off positions the end and leaves rotation alone, for a piece meant to leave at an angle.
- **Profiles**: Strict snaps only matching profiles; Warn snaps any two ends and shows a chip saying the profiles differ; Any snaps silently. Default Warn.
- **Show open ends**: Never, On hover, Always. An open end is one no other end meets. On hover shows the hovered item's, and in a drag those of what the drag carries, the ends about to join; Always shows every open end in the map, which is the "where does the track still need a piece" view. Default On hover. A drag's ends are drawn where the drag has them, through a move, a turn, a scale or a mirror.
- **Flip to fit**: when the piece's mirrored twin would fit the target end and the piece itself wouldn't (a left-handed bevel against a right-handed end), the editor offers the flip in the chip, one click. This uses the game's Flip X and Flip Y ([FORMAT.md](FORMAT.md) § Mirroring), so it round-trips.

**Where on an end** a piece connects is the item's choice, end by end, from a fixed set of spots on the end's cap (`domain/connectorSpots.ts`), named as seen looking out of the end with its up up (the game's +Y to the right of its +X). A rectangle or a polygon has nine: its box's four corners, the middles of its four sides and its centre ("Top left", "Top", "Centre", "Bottom right"…), the box's corners even where a polygon's own don't reach them. A circle or a ring has five: the points of its outer rim straight up, down and to either side, and its centre. Until one is chosen an end connects where it was measured, which is one of its spots: a track's Top, a tube's Centre. The chosen spot moves the end's point and nothing else, its directions stay, so a join, a turn's end stops, a drop, the open-end rings and the snap's marks all use it, and two ends meet at their chosen spots as at their measured ones. Facing each other, one end's left is the other's right, so a piece's Top left lands on a neighbour's Top right with their caps overlapping, and on its Top left a whole width aside. A mirrored item keeps the names as seen. The Inspector's Connects at section sets it for one selected item: a row per end, a grid of its spots with the one in use pressed, the spot ringed in the viewport in the source's colour while its button is hovered. A change is one undo step ("Connect Track S at top left") and takes apart the item's joints it leaves. During a drag the join's label names the spot the end is joining by and points to the Inspector; a hold key would be wrong for a choice that stays with the item.

An end that has met another end is closed, and the pair is remembered in the sidecar as a joint. A joint is what Show open ends counts, what a later "select the whole track" can walk, and what a lint check can read (a track with an open end that isn't a start or a goal).

#### Mesh

The geometry of other items: their meshes or, cheaper, their bounds. This is the general piece-to-piece target, for everything that isn't a track end: a light against a wall, a prop on a ramp, a wall flush with another.

Parameters:

- **Elements**, each its own toggle: bounds corners, bounds face centres, bounds faces, vertices where sharp edges meet, sharp edges, edge midpoints, face centres, faces. All are on by default. A vertex is where sharp edges meet at a corner, and an edge's middle is the middle of the whole edge, not of a facet of it. The mesh elements come from the piece's mesh as the renderer has it. Bounds stand in for a piece whose mesh hasn't loaded, and a piece with a mesh offers none of them, so a curved piece doesn't offer a box face or a corner in the air.
- **Sharp edge angle**: an edge counts when its two faces meet at more than this angle. Default 30°. Below it, flat faces would offer their triangulation as edges, which is never wanted.
- **Occlusion**: In front only (the default), or Through pieces. In front only means a target hidden behind a surface from the active pane's camera doesn't count, so a drag can't land on a vertex the user can't see.
- **Rotate to face**: Keep rotation (the default), Upright on the face, or Align to the face's normal. Upright turns the item about Z only, so its +X faces out of the face and it stays standing: a lamp on a wall. Align is Unreal's "rotate to surface normal": its +Z leaves the face, and a decal or a light placed on a slope faces out of it.
- **Offset**: a distance from the face, in cm, along its normal. Default 0. For things that hover (lights, floating decals).

Bounds snapping is also the alignment target's data (§ Alignment).

##### Under a constrained move

A move along a handle or a lock wants the places that matter along that axis, not every vertex of a neighbour that happens to line up with it. So under a line or a plane the Mesh target offers each near item's stations, and no vertices, edges or edge midpoints:

- **Its faces across the move**: a flat face whose normal runs along the line, or lies in the plane, within 5°. Faces use the Faces toggle. A plane target, it stops the move wherever the rest of the base is, and the Offset and Rotate to face apply as they do on any face.
- **The middle** between the two outermost of those along each direction, when they face apart. It uses the Faces toggle too, and shows as a dashed guide between them.
- **The centres of its faces**, as points, under the Face centres toggle, on a plane handle only: this is what lands on the middle of a cap that looks along the plane's normal. Along a line a face's centre would only be one more middle, so it isn't offered there.

A flat face counts when it is at least 0.25% of the mesh's surface. Below that it is a facet of something curved: a bent tube has 802 flat faces, and its two caps are the only ones that pass. A piece that is curved all the way round, a sphere, has no stations, and Alignment is what lines it up. Bounds stand in here as they do elsewhere: until its mesh has loaded, a piece offers the faces of its box, their middle and their centres, under the bounds toggles.

The selection's own stations (§ Snap base) pair like with like, as Alignment does. A near or far face stops on a face: near on near and far on far lie flush inside, near on far and far on near touch outside. The centre stops on the middle and on no face. So a Track S moved along X through a Track L stops five times: touching, flush, centred, flush, touching.

Nothing hides a station, as it isn't something the pointer picks by sight: a piece moved inside another still stops on its faces. On a plane handle a face of the selection only stops along the axis it is a face of, and stations reached on both axes hold together as Alignment's do: the move lands where their planes cross, with no Rotate to face, and leaving one's range frees that axis only.

#### Construction

Planes and axes that are part of the map's sidecar and never of the map (#92). They are made from a face, from three points, from a world axis or plane, or from another plane with an offset and an angle. They draw as a finite tinted square or a line, with a name.

They snap like geometry: the base lands on the plane or the axis, and an axis crosses a plane at a point. They are also what the other tools ask for a plane or an axis: the mirror plane (#87), the array axis, a tilted grid, the plane two faces are made flush to (#89).

#### Tracking

The CAD answer to "alignment guides, in 3D". Hovering a vertex, corner, face centre or connector end for a moment acquires it: a small plus mark appears on it, and it stays acquired until the next drag or drop from the palette lands, or a drag is cancelled, until more are acquired than the set keeps (6 by default), or until the user clears them (Escape with nothing being dragged, or a button in the popover). What a drag acquires along the way goes when it ends, after the landing has used it. Until then an acquired point belongs to its piece: it goes with the piece through a move, a turn, a mirror, an undo or a re-import from the game, and goes away when the piece is deleted or another map takes its place. During a drag it stays where the document has it. Nothing is acquired on the selection, and a point on what a drag moves isn't a target for that drag: the piece would only be in line with itself.

While dragging, lines through each acquired point along the world's X, Y and Z axes (or the grid's, when the grid is rotated) are targets: the base stops on one as it crosses it, and appears on it with the line drawn. Where two lines cross, the crossing is a point target. Near an acquired point on the pane's view direction, the line along that direction is offered too, which is how an ortho pane puts something straight above a point. Under a line, a tracking line along the move is left out, as one through a point on the move's own line would be met all the way along it.

This is how a piece is put level with one touched 40 m back, or directly above a landing, without the editor searching the whole map for things that line up.

Parameters: how many points are kept, how long a hover takes to acquire (default 400 ms), and whether acquisition is automatic or needs Shift held, as AutoCAD offers both.

#### Alignment

What Excalidraw and tldraw do, limited so it stays quiet in a map of thousands of items.

While a gizmo handle is dragged, the editor compares the selection's bounds (corners, centre, face centres, and face planes) with those of the items visible in the active pane, along the axes the handle allows: one axis for an axis handle, two for a plane handle. When a face plane or a centre of the selection reaches one of theirs, the selection stops there and a dashed guide is drawn between the two, with the distance between the pieces in cm on it, or no distance when they touch or overlap. When the gap between the selection and its neighbour matches the gap between that neighbour and the next, both gaps are drawn, which is Excalidraw's gap snapping.

The label says what lined up and on which axis, and gives a distance only when the distance is what matched, so it doesn't change as the drag closes on a neighbour. A plane reads "Centre level with Track L on Y" or "Near side level with Curve L on X", with the selection's near side, centre or far side along the axis, the neighbour's side as well when it is the other one ("Near side level with far side of Curve L on X"), and the centre when a box of the same size lines up on all three. The axis is the game's X, Y or Z the move runs mostly along, or "an axis" when it runs along none of them. A gap reads "Same gap as Track L to Curve L, 250 cm". A plane handle that lines up on both axes reads "Centre level with Track L on X and Y" when both are the same feature of the same item, and otherwise gives both labels, joined by a semicolon.

The limits are the point. Only items in the active pane's view count, only the handle's axes are searched, and the guides are drawn between the two items that matched, not across the map. In an orthographic pane this is most of what a 2D tool offers, against a cm grid; in perspective it is what makes a row of props line up.

### Priority

More than one target is often to be had. The Snap popover lists the enabled targets in order, and the user drags rows to reorder them. Of the targets a drag has reached and hasn't left (§ What a drag looks like), the first in the list wins, and the rest are ignored for that frame. Being in range isn't enough: a target higher in the list takes over from the current one only once the drag reaches it. Holding Shift keeps the target that is current (§ Modifiers).

The Grid can't be moved out of range the way a target can: a 10 cm grid zoomed out has a line under every pixel. So it claims a frame only while its lines stand at least twice the range apart on screen and one is in range. Otherwise it gives way to what is below it, and whatever the list's order, it is what a move falls back on when nothing else is near. Without this, Grid first would shut out every other target.

Under a handle or a lock, a target must also be within range of where the move has got to, measured along what the move allows, and it is reached when the move's value along the line gets to the target's. A wall far behind a handle lines up with the pointer, but the selection would have to jump to reach it.

Connectors' Pull (§ Connectors) is the one exception to the list's order. Above ×1, Connectors is asked ahead of Grid and Mesh wherever they stand above it, so an end in its range takes the frame from a grid line, a vertex or a face; Construction, Tracking and Alignment keep their places. At ×1 and below the list's order holds, and the Pull only changes the range. So Grid first with a strong pull still lays pieces on the grid, and joins an end whenever one is near.

Two presets, as buttons at the top of the list:

- **Grid first**: Grid, Connectors, Mesh, Construction, Tracking, Alignment. The game's feel, with piece snapping as the extra.
- **Pieces first**: Connectors, Mesh, Construction, Tracking, Alignment, Grid. The grid is the fallback when nothing else is near.

The order is per map, saved with the snap settings in the sidecar. A new map takes the setting's default order (§ Settings). A prefab definition's tab has the same settings, kept in the editor's own prefs since a definition has no sidecar.

Within one target the nearest candidate wins, measured in screen pixels in the active pane. Across elements of the Mesh target a point beats an edge and an edge beats a face, as in Blender, so that a corner is reachable through the face it sits on. That is a drag by the body: under a handle or a lock Mesh offers stations and not vertices or edges (§ Under a constrained move), which is why a vertex stops a body drag and not an axis drag.

### Affect

Which transforms snapping applies to. Move is always on. Rotate and Scale are toggles, as the rotation pill is. All three sit under snapping as a whole, the magnet in the top bar (§ The Snap popover): with it off nothing snaps, whatever each toggle says, and Ctrl turns it over (§ Modifiers).

- **Move**: the base lands on a target.
- **Rotate**: a turn with Snap on stops where the selection meets something, whatever the Rotate toggle says; Rotate is the step, which the turn takes between stops. With Snap off nothing snaps, a turn included, as the magnet gates every transform (§ The Snap popover). Ctrl inverts Snap for the drag, and a held key (§ Modifiers) keeps the stops to one target, or with T the step alone. The stops, from the targets that are on:
  - **Touching** (Mesh): where the selection first touches a neighbour it reaches, each way round. A corner or edge middle of the selection's mesh, or of its bounds until the mesh has loaded, comes onto one of the neighbour's flat faces, or one of the neighbour's onto one of the selection's, within 1 cm. A neighbour it already touches at the start, where the turn takes it in, is met at once, so that way has no touch.
  - **Flush** (Mesh): where a face of the selection comes into the plane of a face of a neighbour, within 1 cm, facing it or facing the same way: a door swung shut on a wall, or a side brought level with the side beside it.
  - **Aligned** (Alignment): where one of the selection's axes comes along one of a neighbour's. "Aligned with Track L on X and Y" names the axes that meet their own, and "Square to Track L" is one laid along another.
  - **End** (Connectors): where an end of the selection comes facing an end of a neighbour, within the Connectors range of it.
  - **Square to the grid** (Grid): where one of the selection's axes comes along the grid's, turned with it.

  A neighbour counts when the turn can reach it: its box is within the selection's sweep about the axis, and the threshold. Flush and aligned stops only count as far each way as the first touch with that neighbour, as past it the selection would be inside it, so a curved piece offers a touch each way and its few real faces and axes, not a stop at every facet. At one angle the most particular stop names it, in the order above with End first. A turn gets to a stop as a move gets to a target (§ Getting to a target): it reaches it on crossing it or coming within a pixel, holds there while the pointer goes on as far as the threshold reaches along the ring it was dragged by (12 px on the 78 px ring is 8.8°), and goes free past that; Shift holds it. The label says what it stopped on, the stop's faces, point or axes are marked, and the history says "Turn 1 item touching Track L".
- **Scale**: scale snaps to the step, along the item's own axes. With a Mesh face (a face of § Under a constrained move, or of the bounds until the mesh has loaded) of a neighbour in range along the scaled axis, the scaled face stops on it, which is how a wall is stretched to meet another. A neighbour counts when its box stands in the way of the selection's along that axis, either way, so a drag's start only places the meshes in line with it, and an item off to the side offers no stop.

### Under the pivot setting

Snapping measures a drag on the items that take it as the gizmo shows it (`leadingKeys`, `domain/units.ts`), and the pivot setting says which those are ([DESKTOP.md § Pivot setting](DESKTOP.md#pivot-setting-together-and-each)).

- **Together:** every unit leads. A link carried along inside an entered chain moves but doesn't lead, so its corners and ends aren't bases.
- **Each:** a move along world axes is the same for every unit, so they all lead it. Under a local move, a turn or a scale only the active unit leads: it lands on the target, and the others take the same move, angle or factor along their own axes and about their own pivots.
- **A lock** is on the grid's axes, so every unit takes the same offset, whatever the handle's axes were.
- **A landing that takes a rotation** (Match rotation, Rotate to face, Flush, a join) is one motion of the whole selection in either mode, as it puts the active unit's base on the target. A chain's links take it once, and it doesn't run down them. A group's Point pivot goes with it, though a turn alone leaves a Point where it is.
- **A turn's stops** assume the active unit ends up turned by the angle dragged. A turn running down a chain in Each goes past that, so it takes the rotation step and nothing else.

## What a drag looks like

1. The user grabs the selection by a gizmo handle or by an item's body. A press and drag on the body moves the selection only as the Drag body setting says: by default (To join) only with snapping and the Connectors target on and an end among what the drag carries, since joining two pieces at their ends is what a body drag is for; Always and Never are the others. Otherwise the press is only the click it always was. While nothing is in range the base point is drawn as a white dot. With Closest, the dot jumps between candidates as the pointer moves.
2. On the way to a target the selection stays with the pointer, or on the grid, and nothing pulls it forward. When it gets to the target it stops there, while the pointer goes on and is never moved. Once the pointer is past the threshold the selection goes free and catches up with it (Baudisch's snap-and-go; § Getting to a target has the rule). The snap is drawn as § Snap indications says: what landed, what it landed on, and the glyph of the kind of snap.
3. One short label in the active pane's corner says what snapped, the same glyph before its words: "Corner of Track L", "End of Curve M", "Centre level with Kicker1 S on Y", "Same gap as Kicker1 S to Track L, 250 cm", "Grid 10 cm", "Plane: Landing". The label is the one place every target reports, so a user who doesn't know which target fired can read it.
4. Releasing commits one undo step, as a drag does today. The snap that was current is in the step's description ("Move 3 items to end of Curve M"), so the history reads as what happened. A drag the pointer is taken from (the system cancels it, or the window loses the capture) is cancelled, as Escape cancels it: the selection goes back and nothing is committed.

### Snap indications

Every snap draws both of its sides, each in its own colour: the **source**, the part of the selection that landed (a point, an end, or a face of its box), in violet, where the snap puts it; and the **target**, what it landed on, in amber. A point's source is a ring round the target's dot, and an end's a ring round the target's ring, so both show where they meet. A glyph says the kind of snap, white on a dark badge beside the landing (on the side away from a join's arrow), and the label shows the same glyph before its words. The kinds, their glyphs and their drawings are a closed list (`SnapRelation` in `domain/snapFrame.ts`, the glyphs in `editor/snap/snapGlyphs.ts`); a Rotate or Scale stop (§ Affect) uses the same list.

| Kind          | Glyph                           | Drawn in the scene                                                                                                                                            | Example label                                                      |
| ------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Coincident    | a dot                           | The target point, and the source's point on it                                                                                                                | "Corner of Track L", "Vertex of Kicker1 S", "End of a measurement" |
| On edge       | a line with end ticks and a dot | The edge, a tick across each end, and the source's point on it                                                                                                | "Edge of Track L", "Axis: Spine"                                   |
| Midpoint      | a triangle                      | The middle of an edge as a point; the middle of a piece as a guide between its two faces, a dot at its middle                                                 | "Middle of an edge of Track L", "Middle of Track L"                |
| Centre        | a crosshair in a circle         | The centre of a face as a point                                                                                                                               | "Centre of a face of Track L"                                      |
| On face       | a square                        | The face, tinted                                                                                                                                              | "Face of Track L", "Plane: Landing"                                |
| Flush         | two parallel bars               | Both faces tinted, the selection's on the target's plane. A turn draws the base face where the turn leaves it, and a scale the scaled face where it stops     | "Face of Track L"                                                  |
| Tangent       | a circle on a line              | The face, while Flush and tangent's panel is set to Tangent                                                                                                   | "Face of Track L"                                                  |
| Perpendicular | a right angle                   | The face, when Rotate to face's Align stands the selection square on it                                                                                       | "Face of Track L"                                                  |
| Aligned       | two slanted dashes              | The outlines of the two sides that lined up (or their centres), and a dashed guide between them in the plane they share, with the distance between the pieces | "Near side level with far side of Track L on Y"                    |
| In line       | three dashes                    | The tracking line in its axis's colour, from the acquired point                                                                                               | "In line with Corner of Kicker"                                    |
| Intersection  | a cross                         | The two tracking lines to where they cross, or the axis and the plane                                                                                         | "Crossing of Corner of Kicker and Corner of Curve"                 |
| Join          | a ring and an arrow             | Both end rings, and an arrow out of the target's end, the way the track goes on                                                                               | "End of Curve M"                                                   |
| Grid          | a grid                          | The source's point on the grid                                                                                                                                | "Grid 10 cm"                                                       |
| Gap           | a span between two bars         | The two sides that face across the new gap, and a dimension guide along the move for it and for the gap it copies, each with its length                       | "Same gap as Kicker1 S to Track L, 250 cm"                         |

The target picker draws only the target and the glyph, as a pick has no selection.

### Getting to a target

Every target but the Grid is a place to get to, and the Grid is a rounding of every position, so it goes on as § Priority says.

- **A line, edge or plane** is reached when the move crosses it, or comes within a pixel of it. Then the selection slides along it.
- **A point** can't be expected to be crossed exactly in two dimensions, so it is reached when the move passes it within a third of the threshold: the selection moves sideways by at most that, never forwards. A connector end takes its whole Range, since the join turns the piece anyway. On a line the move can only go through it. A point on a line or edge the selection is sliding along is met by the selection, however far off to the side the pointer is.
- **A face under the pointer** needs no reaching: the selection is on it the moment the pointer is, with nothing to jump across on screen. A handle or a lock doesn't take one: its faces are stations, which are planes.

A drag only arrives at what it was coming up to. It doesn't catch on a target it started on or turned back from, and a sample that goes past a target by more than the threshold has gone through it, which is how a fast move ignores what it passes. A lock starts afresh, as what the pointer means has changed.

A hover or a click has nowhere to come from, so the target picker and a drop from the palette (§ Placement from the palette) take what's within the threshold.

A body drag in an orthographic pane keeps its depth, as a rise along the view wouldn't show. A point, an edge, a line or a face seen edge-on sets the two values across the view, and the base keeps its own along it. A face within 5° of looking straight at the pane isn't offered. A sloped face still sets the height, and a connector end still joins where it is, as a join is the two ends meeting. A pick and a drop have no depth of their own, so they take what they point at.

### Modifiers

| Key           | While dragging                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ctrl held     | Inverts snapping as a whole, the magnet: off while held when it is on, on while held when it is off. What it turns on is what the toggles under it say. Blender and Unreal both do this, and it is the one key a user needs to know. |
| Shift held    | Holds the current target, if the selection is on one. It stays on the edge, plane or line, sliding along it past the threshold, and no other target takes over. Combined with Ctrl, the held target still holds.                     |
| X, Y, Z       | Locks the move to that world axis (or the grid's axis, when rotated), as SketchUp's arrow keys do. A snap target still sets the value along the locked axis. Pressing again unlocks.                                                 |
| Shift+X, Y, Z | Locks to the plane perpendicular to that axis.                                                                                                                                                                                       |
| G held        | Grid only, during a move: every other target is off while it is held.                                                                                                                                                                |
| J held        | Connectors only, during a move or a turn. J for join: C is the game's key for the gizmo's axes.                                                                                                                                      |
| M held        | Mesh only, during a move, a turn or a scale: its points, edges and faces, or the faces a turn or a scale stops on.                                                                                                                   |
| L held        | Alignment and Tracking only, during a move. L for line up: A flies the camera left.                                                                                                                                                  |
| T held        | The step only, during a turn or a scale: the rotation or scale step, and no face or end stops it.                                                                                                                                    |
| Escape        | Cancels the drag, as today. With no drag, clears acquired tracking points.                                                                                                                                                           |

G, J, M and L narrow snapping to their kind for as long as they are held, and let go of it when they come up. The kind keeps its parameters, its range and its place in the priority list, and holding two keys keeps both kinds. Under a target's key a turn or a scale takes no step, and T held with it brings the step back. One of these held with snapping off turns it on for that kind, as Ctrl does, and Ctrl held with it turns it off again. Shift still holds the current target whatever it is. A key that means nothing to the drag (G in a turn, T in a move) does nothing. Nothing else hears them while the drag lasts, so one rebound onto a fly key doesn't also fly. They count from the press on a handle or the selection's body, and a key held before the press doesn't.

From that press to the release, the middle of the status bar lists the keys the drag can take, Blender style, each as a key chip and a word: `Control` invert, `Shift` hold, `X` `Y` `Z` lock, `G` grid, `J` connectors, `M` mesh, `L` align for a move; `Control` invert, `J` connectors, `M` mesh, `T` step for a turn; `Control` invert, `M` mesh, `T` step for a scale. A held key or the axis locked takes the pressed wash (`components/DragKeyHints.tsx`). They take the sync chip's place, which has nothing to say until the drag lets go, and the right end keeps saying what snapped (§ The Snap popover).

The fly keys and the camera's own modifiers are unchanged ([DESKTOP.md](DESKTOP.md) § View panes); these apply only once a drag has begun, so flying and snapping don't contend.

### Placement from the palette

Dragging a piece out of the palette lands by the same targets and priority as a drag, with the base at the piece's Bottom pivot (or its first end, with Connectors on). Nothing is moving yet, so there is nothing to stop: what's within the threshold of the pointer takes the drop, and a new Track S dropped near a Curve L's end joins it, and a lamp dropped on a wall sits on the wall with Rotate to face deciding which way it faces. With nothing in range the piece lands as today, at the placement distance on the grid height.

## The Snap popover

Snapping has three places, from quickest to fullest: the magnet and its menu in the top bar, the pills in the viewport, and the Snap popover.

**The magnet** sits in the top bar after the menus, as snapping is a way of editing, and the bar's right end is for what goes to the game (a browser doesn't show it, which would leave the magnet alone at the far edge). It turns snapping as a whole on and off, N by default (`snapToggle`), and is pressed while snapping is on. Grid, Rotation, Scale and each target keep their own toggles under it. With the magnet off nothing snaps, and the controls under it stay working but dimmed, to say they wait on it. Ctrl inverts the magnet for one drag (§ Modifiers).

**The snap menu** is the chevron beside the magnet, a popover of rows top to bottom:

- **Snapping**: the magnet's switch.
- **Grid**, **Rotation**, **Scale**: each a step, typed or picked from the list, and a switch. Picking a step turns that one on.
- **Connectors**, **Mesh**, **Alignment and tracking**: the targets' switches, Alignment and Tracking as one.
- **Priority**: Grid first or Pieces first, as a segmented control; neither is pressed for an order of the user's own.
- **Connector pull**: a slider of five stops, from Grid and mesh to Connectors (§ Connectors, § Priority).
- **Defaults…** opens Settings › Editor at Snapping, and **Snap settings…** the Snap popover.

**The pills** keep the short form in the viewport's top right: the Grid pill, whose icon turns the Grid target on and off and whose value picks the grid step; the rotation pill, the same for a turn's step; and a chevron that opens the Snap popover. Both pills dim while the magnet is off. The View menu's Snap section has the same switches as the snap menu, with the magnet's key on Snapping, then the presets, the grid step, and Open snap settings.

**The Snap popover** is everything, top to bottom:

- **Base**: Pivot, Closest, Centre, as a segmented control, and Drag body (To join, Always, Never; § What a drag looks like) under it.
- **Affect**: Move (always on, shown for the row to read), Rotation and Scale, each a step and a switch.
- **Targets**: the priority list, with the two presets as a segmented control beside the title. Each row is a handle to drag it by, the target's name, a one-line summary of its parameters ("10 cm, world origin"; "Warn, show on hover, pull ×2"), a disclosure that opens the parameters, and its switch.
- **Tracking points**: how many are acquired, and Clear.
- **Threshold**, the one slider every target shares: how far past a target the pointer goes before the selection is free.

The three are built from one set of rows (`components/SnapParameters.tsx`), as are Settings › Editor › Snapping's: a 28px row with its label at the left and its control at the right, which drops under the label when the two can't share the width. A switch is a `Switch`, a choice of a few words a `ToggleGroup`, a step a `StepField`, a number a field of the same width, so their edges line up down a list, and a cluster of actions (the grid's origin, the construction planes) is buttons of the same height. Blocks sit 8px apart and their rows flush. A target's parameters open the same way in the popover and in Settings, under a chevron that turns down, indented under its title.

The status bar's right end shows the current base and the first target asked while a drag is in progress, in the same words as the pane's label.

## Tools built on the targets

These are open issues already. What changes is that each takes its points, faces and planes from the same target picker as a drag, so there is one way to say "that corner" or "that face" in the whole app: hover and click, with the same highlights and label.

- **Flush and tangent** (#89). Click a face on item A, click a face on item B: B moves so the faces are coplanar (Flush) or touching (Tangent). An offset field in the same small panel. With Connectors on, clicking two ends joins them, which is the same tool with ends for faces.
- **Align and distribute** (#88). The menu form of alignment snapping: align the selection's min, centre or max on an axis to the first-selected item or the selection's bounds; distribute with equal spacing or equal gaps. Equal gaps is the gap guide made permanent. Both work on the selection's units ([pivot modes and chains](design/pivot-modes-and-chains.md) § Units): a whole group moves as one box and keeps its layout, and it takes two units to align and three to distribute. Inside an entered chain a selected link takes its own offset, and the links after it follow as far as the next selected link.
- **Measure** (#99). Two clicks on any target give the distance and per-axis deltas; a click on two faces gives the angle. A measurement is a sidecar annotation that stays until cleared, and it is a target itself, so a jump can be measured and then built to.
- **Mirror** (#87). The plane comes from the target picker: a face, a construction plane, a world plane through the grid origin. One reflection takes the whole selection, Together or Each, so a group comes out as its mirror image with its Point pivot reflected too. Inside an entered chain the links a selected link carries are reflected with it.
- **Grid origin** (#84). Pick a point with the target picker.
- **Select connected**. Walks the joints from the selection to select the whole track. Not an issue yet; it falls out of joints being recorded.

## Connector data

Connectors need, per piece, the ends: position and the two directions in the piece's local frame, and the profile. The catalog's bounds are not enough, since a curved piece's box corners are nowhere near its ends.

- The data is read off the meshes by a survey of their flat caps (`pnpm --filter @ballest/extract connectors`), and a family is confirmed by placing pieces joined by those ends in the game with the game driver, reading them back and looking at them, as `tools/extract/panel.json` and `paint-measured.json` were measured ([qa/connectors.md](qa/connectors.md)). It lives beside them as `tools/extract/connectors.json` and is folded into `assets/catalog.json` by the extract pipeline, never edited by hand in `assets/`.
- A piece can have any number of ends (a Bevel_F Branch has three; a Cap has one). The player start and the goal have an end each, so a track can begin and finish on a connector.
- Profiles are named for the families in the catalog's display names (Track, Bevel_F, Bevel_H, Bevel_C, Bevel_T, Round, Pipe Q, Tube F, Tube H and the rest in [qa/connectors.md](qa/connectors.md) § What is covered) and the family a piece belongs to is part of its connector record, not derived from its name at run time. A cap that differs in area, size or the height of its running surface is a profile of its own, so a half tube's end doesn't fit a full tube's.
- A piece with no connector data has no ends: Connectors do nothing for it and Mesh and Bounds carry it. That is what every piece is until measured, so the feature grows piece family by piece family and nothing waits on all of it.
- An end is anchored on the running surface, not the middle of its cap: pieces that join level have caps centred at different heights. A section ridden through, a full tube or a pipe, is anchored on its middle ([qa/connectors.md](qa/connectors.md) § What an end is).
- Each end carries its cap's shape (a rectangle, polygon, circle or ring, and its size), which its spots are placed on (§ Connectors).
- A lopsided cross-section has a hand, the side its top leans to looking out of the end. Two ends fit when their hands differ, and Flip to fit offers the mirrored twin when they don't.
- Mirroring an item (Flip X, Flip Y) mirrors its ends with its geometry, as it does its bounds ([FORMAT.md](FORMAT.md) § Mirroring).

## What the sidecar holds

All of this is the editor's, none of it the game's, so it goes in the map's sidecar ([PROJECTS.md](PROJECTS.md) § The files):

- The snap settings for the map: base, affect, steps, each target's toggle and parameters, and the priority order.
- The grid's origin and rotation.
- Construction planes and axes, named.
- Joints: pairs of item ends that met. They are recorded when a connector snap commits and dropped when either item moves away or is deleted, here or in a save from the in-game editor.
- Where each item's ends connect, when not at the measured point: `connectAt` on the item's entry, a spot by end index (`{"0": "topLeft"}`), absent for an end at its default (§ Connectors). A joint names the end by its index whichever spot it is at.
- Measurements.
- Acquired tracking points are not saved; they are a drag's working set.

Export writes none of it, and the game never sees it.

## Settings

Settings › Editor has a Snapping section for what a new map starts on: snapping as a whole on or off (the magnet), the base, Drag body, the preset (Grid first or Pieces first), the steps and whether a turn and a scale snap, the threshold in pixels (default 12), and each target's toggle and parameters, with the same controls as the Snap popover behind each target's Parameters. The grid's origin and rotation are numbers there, as there is no selection to take them from. Use this map's makes all of a map's settings, a custom priority among them, what a new map starts on. A map's own settings, once changed, live in its sidecar and override these.

Keybinds for the modifiers (§ Modifiers) sit with the other editor keybinds and can be rebound, since the game's own keybinds take some keys.

## Defaults by pane

An orthographic pane and a perspective pane want different things. By default:

- Perspective: Grid, Connectors and Mesh on; Tracking and Alignment on but quieter (alignment guides only for items within the threshold, no gap guides).
- Orthographic: everything on, with gap guides, since a flat view against a cm grid is where alignment pays off most.

This is one more parameter on the Alignment target, "Gap guides: In orthographic panes, Always, Never", not a second settings set.

## Decisions

- **Meshes, with bounds standing in.** A piece's real faces are what a user means, and a box face of a curved piece is somewhere in the air. Bounds cost nothing and every catalog piece has them, so they carry a piece until its mesh has loaded, and no longer.
- **Stations under a constraint.** A body drag goes where the pointer is, so what's under the pointer is what's meant, Blender's rule. A handle or a lock goes along an axis, where a neighbour's vertices are only noise: thousands on a curved piece, each stopping the move. There the question is where along the axis, and the answer is a face, a middle, or the far face.
- **Connectors are a data project, and worth it.** Roughly half the Tracks, Ramps, Tubes and Pipes pieces are curved, and for them only connectors or mesh elements join cleanly; connectors also carry the rotation and the profile, which mesh elements can't. The measuring is per family and can start with Track and Bevel_F.
- **Tracking, not global guides.** Excalidraw's always-on search over everything is right for a page and wrong for a map of thousands of items. Acquired points, plus alignment limited to the active pane and the handle's axes, keep guides predictable.
- **Priority is visible.** FreeCAD ranks snaps implicitly (a weak Near snap loses to any strong snap in range) and the user can't see it. A list that reads top to bottom is the rule.
- **One target picker.** Flush, Measure, Mirror and Grid origin all pick with the same hover, highlight and label as a drag. Nothing grows a picker of its own.
- **Snap-and-go.** The selection stops at a target instead of jumping to it, so what it lands on is what it got to, moving past a target is one motion, and no modifier is needed to escape it. Ctrl is there for the user who wants it.
- **Ends win the base.** With Connectors on, a piece with ends moves by its nearest end. The pivot setting still says where it turns and scales.
- **Settings stay out of the history.** A map's snap settings are an unsaved change of it, but not an undo step: undoing a move shouldn't turn snapping off. Construction geometry, measurements and joints are the document's, and undo with it.

## Open questions

- Whether a joint should hold the two items together when one is moved (a weld). A weld is a different feature (a track as one object), so joints are only a record for now; the record is what a weld would need.
- Whether the Alignment target should also compare against construction planes and the grid's lines in perspective, or whether Tracking covers that.
- How a prefab instance's ends are found: from its definition's open ends, presumably, so a prefab track section joins like a piece. Left for the prefab work.

## Sources

- Bier and Stone, "Snap-dragging", SIGGRAPH 1986, and Bier, "Snap-dragging in three dimensions", 1990: gravity to points, lines and planes, and alignment objects.
- Baudisch, Cutrell, Hinckley and Eversole, "Snap-and-go", CHI 2005: stopping at targets instead of warping to them.
- Blender's snapping (snap base, snap target, affect; a point beats an edge beats a face; occlusion from the view).
- Rhino's SmartTrack and AutoCAD's object snap tracking (acquired points, tracking lines, their crossings).
- FreeCAD's Draft Snap (the full list of snap types, and the implicit ranking this design makes explicit).
- Excalidraw and tldraw (alignment and gap guides, searched only within the view and the handle's axes).
- Unreal Engine's actor snapping (surface snapping with rotate to normal and an offset; vertex snapping).
- Joel Burgess's Skyrim and Fallout 4 modular level design talks (snap to reference, local grids).
