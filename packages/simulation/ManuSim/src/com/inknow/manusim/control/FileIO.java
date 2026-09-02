package com.inknow.manusim.control;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.logging.Level;
import java.util.logging.Logger;

public abstract class FileIO {

	// methods

	public static void saveSetupFile( int[] vec, String fileName ) throws IOException {
		try {
			DataOutputStream dataFile = new DataOutputStream( new FileOutputStream( fileName ) );
			for( int i = 0; i < vec.length ; i++ ) {
				dataFile.writeInt( vec[i] );
			}
			dataFile.close();
		} catch (IOException ex) {
			Logger.getLogger( ControlFrame.class.getName() ).log( Level.SEVERE, null, ex );
        }
	}
	
	public static int[] loadSetupFile( String fileName, int length ) {
		int[] vec = new int[length];
		try {
			DataInputStream dataFile = new DataInputStream( new FileInputStream( fileName ) );
			for(int i = 0; i < vec.length ; i++) {
				vec[i] = dataFile.readInt();
			}
			dataFile.close();
		} catch (IOException ex) {
			Logger.getLogger( ControlFrame.class.getName() ).log( Level.SEVERE, null, ex );
        }
		return vec;
	}

}
