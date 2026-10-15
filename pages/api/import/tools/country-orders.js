import sql from 'mssql';
import { withAuth } from '../../../../lib/auth';
import { query } from '../../../../lib/db';
import { createCountryOrderSourceHandler } from '../../../../lib/countryOrderSourceApi.js';

export default withAuth(createCountryOrderSourceHandler({ queryFn: query, types: sql }));
