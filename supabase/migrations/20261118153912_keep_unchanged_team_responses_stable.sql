CREATE OR REPLACE FUNCTION public.os_team_merge_forms(p_owner uuid, p_source jsonb, p_responses jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
 w jsonb; forms jsonb; rows jsonb; incoming jsonb; previous jsonb; merged jsonb; history jsonb; position integer; added integer=0; changed integer=0; key text;
begin
 if current_user not in ('postgres','service_role') then raise exception 'BACKGROUND_SYNC_ONLY' using errcode='42501'; end if;
 if jsonb_typeof(p_responses)<>'array' or jsonb_array_length(p_responses)>5000 then raise exception 'INVALID_RESPONSES'; end if;
 select state into w from public.development_workspaces where user_id=p_owner for update;
 if not found then raise exception 'WORKSPACE_NOT_FOUND'; end if;
 forms=coalesce(w->'formsOneOnOne','{}'::jsonb); rows=coalesce(forms->'responses','[]'::jsonb);
 for incoming in select value from jsonb_array_elements(p_responses) loop
  key=incoming->>'sourceKey';
  if coalesce(key,'')='' or jsonb_typeof(incoming->'answers')<>'array' then raise exception 'INVALID_RESPONSE'; end if;
  select ordinality::integer-1,value into position,previous from jsonb_array_elements(rows) with ordinality where value->>'sourceKey'=key limit 1;
  if found then
   history=coalesce(previous->'history','[]'::jsonb);
   if previous->'answers' is distinct from incoming->'answers' then
    history=history||jsonb_build_array(jsonb_build_object('answers',previous->'answers','archivedAt',now()));
    changed=changed+1;
   end if;
   if previous @> (incoming-'id'-'preparation'-'history'-'importedAt'-'fingerprint') then
    merged=previous;
   else
    merged=previous||(incoming-'id'-'preparation'-'history'-'importedAt')||jsonb_build_object('id',previous->>'id','history',history,'lastImportedAt',now());
   end if;
   if previous->'answers' is distinct from incoming->'answers' then merged=merged||'{"preparationStale":true}'::jsonb; end if;
   rows=jsonb_set(rows,array[position::text],merged);
  else
   rows=rows||jsonb_build_array(incoming||jsonb_build_object('id','forms1on1-'||md5(key),'importedAt',now(),'history','[]'::jsonb));
   added=added+1;
  end if;
 end loop;
 forms=forms||p_source||jsonb_build_object('responses',rows,'lastCheckedAt',now(),'frequency','hourly');
 update public.development_workspaces set state=jsonb_set(w,'{formsOneOnOne}',forms),revision=revision+1,updated_at=now() where user_id=p_owner;
 return jsonb_build_object('added',added,'changed',changed,'total',jsonb_array_length(rows));
end;$function$
