"""Request schemas. Geometry is the canonical 2D plan: centimetres, origin top-left, y down."""

import math
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, model_validator

MAX_COORD_CM = 100_000  # 1 km: far beyond any residential plan
MAX_ITEMS = 1000

Id = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,40}$")]
Cm = Annotated[float, Field(ge=-MAX_COORD_CM, le=MAX_COORD_CM, allow_inf_nan=False)]
Size = Annotated[float, Field(gt=0, le=MAX_COORD_CM, allow_inf_nan=False)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class Room(Strict):
    id: Id
    name: Name
    type: Annotated[str, StringConstraints(max_length=30)]


class Wall(Strict):
    id: Id
    x1: Cm
    y1: Cm
    x2: Cm
    y2: Cm
    thickness: Annotated[float, Field(gt=0, le=100, allow_inf_nan=False)]
    kind: Literal["exterior", "partition"]
    roomId: Id | None = None

    @property
    def length(self) -> float:
        return math.hypot(self.x2 - self.x1, self.y2 - self.y1)

    @model_validator(mode="after")
    def _non_zero_length(self):
        if self.length < 1:
            raise ValueError("wall must be at least 1 cm long")
        return self


class Opening(Strict):
    id: Id
    wallId: Id
    type: Literal["door", "window"]
    offset: Annotated[float, Field(ge=0, le=MAX_COORD_CM, allow_inf_nan=False)]  # from wall start to opening start
    width: Size


class Furniture(Strict):
    id: Id
    type: Annotated[str, StringConstraints(pattern=r"^[a-z0-9_-]{1,40}$")]
    x: Cm
    y: Cm
    w: Size
    d: Size
    rotation: Annotated[float, Field(ge=-360, le=360, allow_inf_nan=False)]


class Geometry(Strict):
    schema_version: Literal[1] = Field(alias="schema")
    units: Literal["cm"]
    rooms: Annotated[list[Room], Field(max_length=100)]
    walls: Annotated[list[Wall], Field(max_length=MAX_ITEMS)]
    openings: Annotated[list[Opening], Field(max_length=MAX_ITEMS)]
    furniture: Annotated[list[Furniture], Field(max_length=MAX_ITEMS)]

    @model_validator(mode="after")
    def _references_are_consistent(self):
        for items in (self.rooms, self.walls, self.openings, self.furniture):
            ids = [item.id for item in items]
            if len(ids) != len(set(ids)):
                raise ValueError("duplicate id")
        room_ids = {room.id for room in self.rooms}
        walls = {wall.id: wall for wall in self.walls}
        for wall in self.walls:
            if wall.roomId is not None and wall.roomId not in room_ids:
                raise ValueError(f"wall {wall.id} references unknown room")
        for opening in self.openings:
            wall = walls.get(opening.wallId)
            if wall is None:
                raise ValueError(f"opening {opening.id} references unknown wall")
            if opening.offset + opening.width > wall.length + 0.01:
                raise ValueError(f"opening {opening.id} does not fit in its wall")
        return self


class StudioCreate(Strict):
    name: Name


class InviteCreate(Strict):
    client_email: EmailStr
    client_name: Name


class ProjectCreate(Strict):
    studio_id: UUID
    name: Name
    property_type: Literal["existing", "new_build"]


class VersionCreate(Strict):
    label: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] = ""
    geometry: Geometry


MAX_QUESTION_CHARS = 2000
MAX_TURN_CHARS = 8000
MAX_HISTORY_TURNS = 10


class Turn(Strict):
    role: Literal["user", "assistant"]
    content: Annotated[str, StringConstraints(min_length=1, max_length=MAX_TURN_CHARS)]


class AdvisorAsk(Strict):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_QUESTION_CHARS)]
    history: Annotated[list[Turn], Field(max_length=MAX_HISTORY_TURNS)] = []
