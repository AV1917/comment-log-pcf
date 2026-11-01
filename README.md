# Comment Log PCF

![Key Features](https://github.com/user-attachments/assets/5aeecf7a-c711-4198-816f-2e617aa19139)

## Overview

Comment Log is a dataset PCF control for creating and displaying comments on a model-driven app form. It uses a subgrid connected to your own Dataverse table, with flexible column mappings and configurable settings for requirements that aren't always practical with standard activities or the timeline control.

![Making a Comment](https://github.com/user-attachments/assets/4afc7a71-57e2-4c70-9d4e-92026a89722f)

## Use cases

### Data migrations & incomplete historical records

Migrating large volumes of comments from another system can present problems with author attribution. Some original authors can be mapped to Dataverse users, others may only have a name recorded as text, and some comments may have no reliable author information at all.

Comment Log accommodates this through a three-level author fallback: **mapped user lookup > plain text author > configurable placeholder**. Each comment displays the best available attribution, whether that's a proper Dataverse user, the original author's name, or a configurable placeholder such as *Unknown User*. New comments can then populate the same mapped columns with the current Dataverse user's details, without being restricted by the quality of the imported history.

![Demonstration of Fallback](https://github.com/user-attachments/assets/4bdb0dcd-690a-4b9a-8439-f4bb7400222a)
*Top down – Author Placeholder, Comment Author (Text), Comment Author (Lookup).*

### Independent comment records & bespoke permissions

Activities aren't always suitable when a solution requires a particular ownership or security structure, especially where the ability to view, edit, or delete individual comments needs to be controlled differently from standard activities.

Comment Log works with your own custom Dataverse table, allowing you to define the required ownership, relationships, and record-level permissions independently of the activity model.

It can also be useful simply to keep different kinds of information separate. For example, a case might already use the standard timeline for emails, tasks, and other activities, while requiring a dedicated comment history for internal case notes.

### Multiple comment logs & categories

Comment Log can use the same Dataverse table across multiple instances, with each subgrid configured to display a different set of comments. For example, a record might have separate logs for general notes, decisions, and status updates, without requiring a dedicated table for each.

Comment categorisation is optional, enabled by mapping the **Comment Type** parameter to a Choice or Status Reason column. Users can select a type when creating a comment, or the **Apply Type on Create** parameter can automatically assign a predefined value. This allows each log to display only the relevant comments while assigning the appropriate type to new ones. Alternatively, a single log can display all categories together and allow users to select the type themselves.

Comment types can also be used to drive additional behaviour through Dataverse plugins. For example, a PreValidation plugin registered on Create can use the assigned type to determine the record's owner, Business Unit, or other field values. This allows comments created through different instances of the Comment Log to follow different security or processing rules while sharing the same underlying table.

![Type on Create](https://github.com/user-attachments/assets/8a21dc55-2881-40d4-932a-b4520e03f014)
*Two instances of Comment Log, each configured with a different **Apply Type on Create** value and a corresponding subgrid view filtered by that type.*

### Commenting on inactive records

Some processes continue after the parent record has been closed. Post-closure updates, follow-up notes, or additional correspondence may still need to be recorded, even though the parent form has become read-only.

The **Override Inactive?** setting allows users to continue creating comments against an inactive parent without reopening it, provided they have the necessary Dataverse permissions.

### Commenting without parent Write access

Users may need to add comments to records they can access but aren't permitted to edit. For example, a user might have permission to create comments and associate them with a parent record, but deliberately have no Write access to the parent itself.

By default, Comment Log requires parent Write access to use, mirroring default form permissions. Disabling **Lock if No Parent Write?** removes that requirement, allowing comment creation where the user has the necessary Create and Append privileges on the selected comments table, and Append To on the parent.

## Install & configure

1. Import a solution ZIP from the [latest release](https://github.com/AV1917/comment-log-pcf/releases) into your target environment.
2. Open the parent table's main form and add a **Subgrid**.
3. Enable **Show related records**, select the comments table through its parent relationship, and choose a view with the filters and sort order you want to use for the control.
4. Under **Components > + Component**, select **Comment Log**. Use **Get more components** if it isn't listed.
5. Configure the [column mappings](#column-mappings) and [settings](#settings) as shown below.
6. Save and publish the form.

In the classic form editor, use **Subgrid Properties > Controls > Add Control**.

![Example Configuration](https://github.com/user-attachments/assets/d4f84e25-a089-4118-80d9-5e4e5dbc35c0)

### Column mappings

<table>
  <thead>
    <tr>
      <th>Parameter</th>
      <th>Default</th>
      <th>Required?</th>
      <th>Column to use</th>
      <th>Configuration and behaviour</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Comment Body</strong></td>
      <td>—</td>
      <td>Yes</td>
      <td>Multiple lines of plain text.</td>
      <td>Displays the body with line breaks preserved.</td>
    </tr>
    <tr>
      <td><strong>Date</strong></td>
      <td>—</td>
      <td>Yes</td>
      <td><strong>Created On</strong> or a custom Date and Time or Date Only column.</td>
      <td>Displays the formatted date, or <em>Unknown Date</em> when blank. Populated with the current date and time on creation of a new comment.</td>
    </tr>
    <tr>
      <td><strong>Comment Title</strong></td>
      <td>—</td>
      <td>No</td>
      <td>Single line of text or text area.</td>
      <td>Map to the table's primary name column to display existing titles and require users to enter one when posting. Otherwise, leave unmapped, but ensure the primary name is either optional or populated automatically by a synchronous workflow or plugin, as it is required by default.</td>
    </tr>
    <tr>
      <td><strong>Comment Type</strong></td>
      <td>—</td>
      <td>No</td>
      <td>Single-select local or global Choice or <strong>Status Reason</strong> (<code>statuscode</code>).</td>
      <td rowspan="2" valign="top">
        <p>Displays the choice field's label and colour, falling back to <strong>Type Placeholder</strong> when no label is available or when <strong>Comment Type</strong> is unmapped.</p>
        <p>Mapping <strong>Comment Type</strong> adds a required type picker unless <strong>Apply Type on Create</strong> supplies a fixed numeric value.</p>
        <p>The picker excludes options with <code>IsHidden = true</code> and, for Status Reason, reasons associated with inactive states.</p>
      </td>
    </tr>
    <tr>
      <td><strong>Type Placeholder</strong></td>
      <td><code>Created</code></td>
      <td>No</td>
      <td>Text setting.</td>
    </tr>
    <tr>
      <td><strong>Comment Author (Lookup)</strong></td>
      <td>—</td>
      <td>No</td>
      <td>Single-table lookup to <strong>User</strong> (<code>systemuser</code>), or <strong>Created By</strong>.</td>
      <td rowspan="3" valign="top">
        <p>Displays the first available value for an individual comment: <strong>Author (Lookup) > Author (Text) > Author Placeholder</strong>. Lookup authors support user photos and opening the user record.</p>
        <p>Either or both author columns can be mapped. New comments populate both columns when mapped, using the current user lookup and display name.</p>
        <p><strong>Author Placeholder</strong> is only used for display where no author value is provided; it is not written back to the record.</p>
      </td>
    </tr>
    <tr>
      <td><strong>Comment Author (Text)</strong></td>
      <td>—</td>
      <td>No</td>
      <td>Single line of text or text area.</td>
    </tr>
    <tr>
      <td><strong>Author Placeholder</strong></td>
      <td><code>Unknown User</code></td>
      <td>No</td>
      <td>Text setting.</td>
    </tr>
    <tr>
      <td><strong>Related Record</strong></td>
      <td>—</td>
      <td>No</td>
      <td>Single-table lookup to the parent. Map the lookup used by the subgrid's relationship.</td>
      <td>Populates the lookup with the current parent when creating a comment, so new comments belong to that record's related list.</td>
    </tr>
  </tbody>
</table>

### Settings

| Setting | Default | Configuration and behaviour |
| --- | --- | --- |
| **Page Size** | `20` | Enter a positive whole number. Sets how many comments are requested initially and with each *Show more* batch. |
| **Apply Type on Create** | Blank | This feature requires a **Comment Type** mapping to use. Leave it blank for users to choose their own type, or enter an option's numeric value to assign it automatically and hide the type picker. |
| **Override Inactive?** | No | Set to **Yes** to allow new comment creation after the parent record is closed or inactive. |
| **Lock if No Parent Write?** | Yes | Set to **No** to allow new comment creation when users can access the parent record but cannot edit it. They will still need Create and Append on the comments table, and Append To on the parent. |

## Usage notes

Comments are loaded according to the configured **Page Size**. Select *Show more* beneath the list to retrieve the next batch.

Individual comments can be selected using their checkboxes. **Select all** retrieves all remaining pages of the current filtered dataset and selects every returned comment, making the selection available to supported subgrid commands. This can be used for bulk operations or exporting records to Excel, subject to the behaviour of the particular command.

Long comments are collapsed after ten lines, with *Show more* and *Show less* controls.

After a successful post, the draft is cleared, the comment list refreshes to include the new comment, and a notification confirms success. If posting fails, the draft is retained and an error notification is shown.

Existing comments can be opened from their cards to access the underlying Dataverse record.

The comment editor can be expanded while composing longer comments.
