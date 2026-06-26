"use client";

import Link from "next/link";
import Image from "next/image";
import { Menu } from "lucide-react";
import { useQuery } from "convex/react";
import { Poppins } from "next/font/google";

import { cn } from "@/lib/utils";
import { Hint } from "@/components/hint";
import { api } from "@/convex/_generated/api";
import { Actions } from "@/components/actions";
import { Button } from "@/components/ui/button";
import { Id } from "@/convex/_generated/dataModel";
import { useRenameModal } from "@/store/use-rename-modal";
import { Participants } from "./participants";

interface InfoProps {
  boardId: string;
};

const font = Poppins({
  subsets: ["latin"],
  weight: ["600"],
});

const TabSeparator = () => {
  return (
    <div className="bg-white/15 w-px h-5" />
  );
};

export const Info = ({
  boardId,
}: InfoProps) => {
  const { onOpen } = useRenameModal();

  const data = useQuery(api.board.get, {
    id: boardId as Id<"boards">,
  });

  if (!data) return <InfoSkeleton />;

  return (
    <div className="absolute top-2 left-2 bg-neutral-900 border border-white/10 rounded-xl shadow-lg flex items-center h-12 px-3 gap-3">
      <Hint label="Go to boards" side="bottom" sideOffset={10}>
        <Button asChild variant="board" className="px-2 text-white/60 hover:text-white hover:bg-white/10">
          <Link href="/">
            <Image
              src="/logo.svg"
              alt="Proofr logo"
              height={40}
              width={40}
            />
            <span className={cn(
              "font-bold text-xl ml-2 text-white",
              font.className,
            )}>
              Proofr
            </span>
          </Link>
        </Button>
      </Hint>
      <TabSeparator />
      <Hint label="Edit title" side="bottom" sideOffset={10}>
        <Button
          variant="board"
          className="text-sm font-medium text-white/80 px-2 hover:bg-white/10 hover:text-white"
          onClick={() => onOpen(data._id, data.title)}
        >
          {data.title}
        </Button>
      </Hint>
      <TabSeparator />
      <Actions
        id={data._id}
        title={data.title}
        side="bottom"
        sideOffset={10}
      >
        <div>
          <Hint label="Main menu" side="bottom" sideOffset={10}>
            <Button size="icon" variant="board" className="text-white/60 hover:text-white hover:bg-white/10 rounded-lg p-1.5 transition-colors">
              <Menu />
            </Button>
          </Hint>
        </div>
      </Actions>
      <TabSeparator />
      <Participants />
    </div>
  );
};

export const InfoSkeleton = () => {
  return (
    <div 
      className="absolute top-2 left-2 bg-[#1a1a2e] border border-white/10 rounded-xl px-3 h-12 flex items-center shadow-lg w-[300px]"
    />
  );
};
