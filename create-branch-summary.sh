#!/bin/bash

# Create/clear the branch summary file
> branch_summary.txt

# Get the current branch name
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo "Creating branch summary for branch $CURRENT_BRANCH compared against main branch."

# Add initial prompt
echo "Write a git merge message to merge this PR branch into main. Describe what has changed, and the important features implemented. Structure the output as markdown. be clear and concise, but include all major changes made in this branch." >> branch_summary.txt
echo "Stat and Differences:" >> branch_summary.txt
echo "" >> branch_summary.txt

# Add the branch summary header to the file
echo "=== BRANCH SUMMARY: $CURRENT_BRANCH ===" >> branch_summary.txt
echo "" >> branch_summary.txt

# Add branch information
echo "=== Branch Information ===" >> branch_summary.txt
echo "Current Branch: $CURRENT_BRANCH" >> branch_summary.txt
echo "Base Branch: main" >> branch_summary.txt
echo "" >> branch_summary.txt

# Add commit history for this branch
echo "=== Commit History (commits in $CURRENT_BRANCH not in main) ===" >> branch_summary.txt
git log main..$CURRENT_BRANCH --oneline --reverse >> branch_summary.txt
echo "" >> branch_summary.txt

# Add detailed commit messages
echo "=== Detailed Commit Messages ===" >> branch_summary.txt
git log main..$CURRENT_BRANCH --reverse --format="Commit: %H%nAuthor: %an <%ae>%nDate: %ad%nSubject: %s%n%nMessage:%n%b%n----%n" --date=short >> branch_summary.txt

# Add the diff statistics to the summary file
echo "=== File Statistics ===" >> branch_summary.txt
git diff main...$CURRENT_BRANCH --stat >> branch_summary.txt
echo "" >> branch_summary.txt

# Add the full diff to the summary file
echo "=== Detailed Changes ===" >> branch_summary.txt
git diff main...$CURRENT_BRANCH >> branch_summary.txt

# echo "Branch summary created in branch_summary.txt"
# echo "Summary includes:"
# echo "  - Branch information"
# echo "  - Commit history"
# echo "  - Detailed commit messages"
# echo "  - File change statistics"
# echo "  - Full diff of changes"
