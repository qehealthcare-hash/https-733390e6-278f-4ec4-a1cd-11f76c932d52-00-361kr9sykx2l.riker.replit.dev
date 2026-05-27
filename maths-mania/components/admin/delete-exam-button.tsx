import { deleteExam } from "@/app/(admin)/admin/exams/actions";
import { Button } from "@/components/ui/button";

export function DeleteExamButton({ examId }: { examId: string }) {
  async function handleDelete() {
    "use server";
    await deleteExam(examId);
  }

  return (
    <form action={handleDelete} className="mt-8">
      <Button type="submit" variant="destructive" size="sm">
        Delete exam
      </Button>
    </form>
  );
}
