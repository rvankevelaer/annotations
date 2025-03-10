<?php

namespace Biigle\Modules\Annotations\Http\Controllers\Views;

use DB;
use Biigle\Role;
use Biigle\Shape;
use Biigle\Image;
use Biigle\Project;
use Biigle\LabelTree;
use Biigle\Annotation;
use Illuminate\Http\Request;
use Biigle\Http\Controllers\Views\Controller;

class AnnotationToolController extends Controller
{
    /**
     * Shows the annotation tool.
     *
     * @param Request $request
     * @param int $id the image ID
     *
     * @return \Illuminate\Http\Response
     */
    public function show(Request $request, $id)
    {
        $image = Image::with('volume')->findOrFail($id);
        $this->authorize('access', $image);
        $user = $request->user();

        if ($user->can('sudo')) {
            // Global admins have no restrictions.
            $projectIds = DB::table('project_volume')
                ->where('volume_id', $image->volume_id)
                ->pluck('project_id');
        } else {
            // Array of all project IDs that the user and the image have in common
            // and where the user is editor, expert or admin.
            $projectIds = Project::inCommon($user, $image->volume_id, [
                Role::editorId(),
                Role::expertId(),
                Role::adminId(),
            ])->pluck('id');
        }

        $images = Image::where('volume_id', $image->volume_id)
            ->orderBy('filename', 'asc')
            ->pluck('filename', 'id');

        // All label trees that are used by all projects which are visible to the user.
        $trees = LabelTree::select('id', 'name', 'version_id')
            ->with('labels', 'version')
            ->whereIn('id', function ($query) use ($projectIds) {
                $query->select('label_tree_id')
                    ->from('label_tree_project')
                    ->whereIn('project_id', $projectIds);
            })
            ->get();

        $shapes = Shape::pluck('name', 'id');

        $annotationSessions = $image->volume->annotationSessions()
            ->select('id', 'name', 'starts_at', 'ends_at')
            ->with('users')
            ->get();

        return view('annotations::show', [
            'user' => $user,
            'image' => $image,
            'volume' => $image->volume,
            'images' => $images,
            'labelTrees' => $trees,
            'shapes' => $shapes,
            'annotationSessions' => $annotationSessions,
        ]);
    }
}
