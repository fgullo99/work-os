import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteContact } from "@/lib/workItems/entities";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  try {
    await deleteContact(supabase, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[contacts DELETE]", err);
    return NextResponse.json({ ok: false, error: "delete_failed" }, { status: 500 });
  }
}
