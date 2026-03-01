package com.inknow.manusim.control;

import javax.swing.UIManager;

/**
*
* @author 	inknow.rns
* @since 	dec.2021
*/

public class Main {

	/**
	 * @param args
	 */
	public static void main(String[] args) {
	    try {
	        switch(1) {
	            case 1: UIManager.setLookAndFeel( UIManager.getSystemLookAndFeelClassName() ); break;
	            case 2: UIManager.setLookAndFeel( UIManager.getCrossPlatformLookAndFeelClassName() ); break;
	        }
	    } catch (Exception e) { }
	    java.awt.EventQueue.invokeLater( 
	    	new Runnable() {
		    	public void run() {
		    		new ControlFrame().setVisible(true);
		    	}
	    	}
	    );
	}
}