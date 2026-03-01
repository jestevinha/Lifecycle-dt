package com.inknow.manusim.control;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Vector;

import com.inknow.manusim.model.Actor;
import com.inknow.manusim.model.Workarea;

/**
 * Data Base Input/Output methods
 * @author rns
 */

public abstract class DBIO {

    private static Connection conn;

    // constructor

    public DBIO() {
        conn = null;
    }
     
    // other methods
    
    public static void resetDB() {
    	java.sql.PreparedStatement ps;
    	if ( conn == null ) {
    		connectDB();
    	}
    	try {
        	ps = conn.prepareStatement( "DELETE FROM ACTOR" );
        	ps.execute();  	
        } catch(SQLException ex) {
            System.out.println( "SQL Exception(resetDB-ACTOR): " + ex.getMessage() );
        }
    	try {
        	ps = conn.prepareStatement( "DELETE FROM EVENT" );
        	ps.execute();  	
        } catch(SQLException ex) {
            System.out.println( "SQL Exception(resetDB-EVENT): " + ex.getMessage() );
        }
    	try {
        	ps = conn.prepareStatement( "DELETE FROM TEAM" );
        	ps.execute();  	
        } catch(SQLException ex) {
            System.out.println( "SQL Exception(resetDB-TEAM): " + ex.getMessage() );
        }
    	try {
        	ps = conn.prepareStatement( "DELETE FROM UNITTYPE" );
        	ps.execute();  	
        } catch(SQLException ex) {
            System.out.println( "SQL Exception(resetDB-UNITTYPE): " + ex.getMessage() );
        }
        try {
        	ps = conn.prepareStatement( "DELETE FROM WORKAREA" );
        	ps.execute();  	
        } catch(SQLException ex) {
            System.out.println( "SQL Exception(resetDB-WORKAREA): " + ex.getMessage() );
        }
        disconnectDB();
        return;
    }
    
    public static void insertActors(Vector<Actor> actors) {
    	if ( conn == null ) {
    		connectDB();
    	}
    	try {
    		java.sql.PreparedStatement ps = conn.prepareStatement( "INSERT INTO ACTOR (ID,NAME,TEAM_ID) VALUE (?,?,?)" );
    		for( int i = 0; i < actors.size(); i++ ){
    			ps.setInt( 1, actors.get(i).getId() );
    			ps.setString( 2, actors.get(i).getName() );
    			ps.setInt( 3, ( actors.get(i).getId() / 100 ) * 100 );
    			ps.execute();
    		}
    	} catch(SQLException ex) {
    		System.out.println( "SQL Exception: " + ex.getMessage() );
    	}
    	disconnectDB();
    	return;
    }
    
    public static void insertTeams() {
    	if ( conn == null ) {
    		connectDB();
    	}
    	try {
    		java.sql.PreparedStatement ps = conn.prepareStatement( "INSERT INTO TEAM (ID,NAME) VALUE (?,?)" );
    		for( int i = 0; i < Const.N_ACTOR_TYPES; i++ ){
    			ps.setInt( 1, Const.ACTOR_TYPE_A + (Const.ACTOR_TYPE_B - Const.ACTOR_TYPE_A)*i );
    			ps.setString( 2, "Team " + Const.TEAM_NAMES.charAt( i ) );
    			ps.execute();
    		}
    	} catch(SQLException ex) {
    		System.out.println( "SQL Exception: " + ex.getMessage() );
    	}
    	disconnectDB();
    	return;
    }
    
    public static void insertUnittypes() {
        if ( conn == null ) {
            connectDB();
        }
        try {
        	java.sql.PreparedStatement ps = conn.prepareStatement("INSERT INTO UNITTYPE (ID,NAME) VALUE (?,?)");
        	ps.setInt(1, Const.UNIT_A1 ); ps.setString(2, "A1"); ps.execute();
        	ps.setInt(1, Const.UNIT_A2 ); ps.setString(2, "A2"); ps.execute();
        	ps.setInt(1, Const.UNIT_A3 ); ps.setString(2, "A3"); ps.execute();
        	ps.setInt(1, Const.UNIT_B1 ); ps.setString(2, "B1"); ps.execute();
        	ps.setInt(1, Const.UNIT_B2 ); ps.setString(2, "B2"); ps.execute();
        	ps.setInt(1, Const.UNIT_B3 ); ps.setString(2, "B3"); ps.execute();
        	ps.setInt(1, Const.UNIT_C1 ); ps.setString(2, "C1"); ps.execute();
        	ps.setInt(1, Const.UNIT_C2 ); ps.setString(2, "C2"); ps.execute();
        	ps.setInt(1, Const.UNIT_C3 ); ps.setString(2, "C3"); ps.execute();
        } catch(SQLException ex) {
            System.out.println( "SQL Exception(insertUnittypes): " + ex.getMessage() );
        }
        disconnectDB();
        return;
    }
	
    public static void insertWorkareas(Vector<Workarea> workareas) {
        if ( conn == null ) {
            connectDB();
        }
        try {
        	java.sql.PreparedStatement ps = conn.prepareStatement("INSERT INTO WORKAREA (ID,UNITATYPE,UNITBTYPE,UNITCTYPE) VALUE (?,?,?,?)");
        	for(int i = 0; i < workareas.size(); i++){
        		ps.setInt(1, workareas.get(i).getId());
        		ps.setInt(2, workareas.get(i).getUnitA().getType());
        		ps.setInt(3, workareas.get(i).getUnitB().getType());
        		ps.setInt(4, workareas.get(i).getUnitC().getType());
        		ps.execute();
        	}
        } catch(SQLException ex) {
            System.out.println( "SQL Exception(insertWorkareas): " + ex.getMessage() );
        }
        disconnectDB();
        return;
    }
    
    //--
    
    public static void 	registerEvent( long timestamp,  int eventType, int workareaId, int currActorId, double currRate, int shiftTimeMinutes ) {
    	if ( conn == null ) {
    		connectDB();
    	}
    	try {
    		java.sql.PreparedStatement ps = conn.prepareStatement( "INSERT INTO EVENT (TS,TYPE,WORKAREA_ID,ACTOR_ID,PRODRATE,SHIFTTIME) VALUE (?,?,?,?,?,?)" );
    		ps.setLong( 	1, timestamp );
    		ps.setInt( 		2, eventType );
    		ps.setInt( 		3, workareaId );
    		ps.setInt( 		4, currActorId );
    		ps.setDouble( 	5, currRate);
    		ps.setInt( 		6, shiftTimeMinutes);
    		ps.execute();
    	} catch(SQLException ex) {
    		System.out.println( "SQL Exception(registerEvent): " + ex.getMessage() );
    	}
    	disconnectDB();
    	return;
    }
    
    // connect & disconnect methods

    public static void connectDB() {
    	try {
    		Class.forName( Const.JDBC_DRIVER_FORNAME );
    	} catch(ClassNotFoundException e) {
    		System.out.println("SQL Exception: class Not Found Exception! - DB driver");
    	}
    	try {
    		conn = DriverManager.getConnection(	Const.JDBC_HOST_PATH,
    											Const.JDBC_HOST_USERNAME,
    											Const.JDBC_HOST_PASSWORD );
    	} catch(SQLException ex) {
    		System.out.println("SQL Exception (connectDB): " + ex.getMessage());
    		conn = null;
    	}
    	return;
    }
    
    public static void disconnectDB() {
    	if ( conn != null ) {
    		try {
    			conn.close();
    			conn = null;
    		} catch(SQLException ex) {
    			System.out.println( "SQL Exception (disconnectDB): " + ex.getMessage() );
    			conn = null;
    		}
    	}
    	return;
    }
}
